const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 10000;

const rooms = new Map();

const COLORS = ["red", "yellow", "green", "blue"];

function createDeck() {
    const deck = [];

    for (const color of COLORS) {
        deck.push({ color, value: "0" });

        for (let i = 1; i <= 9; i++) {
            deck.push({ color, value: String(i) });
            deck.push({ color, value: String(i) });
        }

        for (let i = 0; i < 2; i++) {
            deck.push({ color, value: "skip" });
            deck.push({ color, value: "reverse" });
            deck.push({ color, value: "draw2" });
        }
    }

    for (let i = 0; i < 4; i++) {
        deck.push({ color: "wild", value: "wild" });
        deck.push({ color: "wild", value: "draw4" });
    }

    return shuffle(deck);
}

function shuffle(array) {
    const copy = [...array];

    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }

    return copy;
}

function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code;

    do {
        code = "";

        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
    } while (rooms.has(code));

    return code;
}

function drawCards(room, amount) {
    const cards = [];

    for (let i = 0; i < amount; i++) {
        if (room.deck.length === 0) {
            rebuildDeck(room);
        }

        if (room.deck.length === 0) break;

        cards.push(room.deck.pop());
    }

    return cards;
}

function rebuildDeck(room) {
    if (room.discard.length <= 1) {
        return;
    }

    const top = room.discard.pop();

    room.deck = shuffle(
        room.discard.filter(card => card.value !== "wild" && card.value !== "draw4")
    );

    room.discard = [top];
}

function startGame(room) {
    room.deck = createDeck();
    room.discard = [];
    room.started = true;
    room.turn = 0;
    room.direction = 1;
    room.currentColor = null;

    for (const player of room.players) {
        player.hand = drawCards(room, 7);
    }

    let firstCard;

    do {
        firstCard = room.deck.pop();
    } while (
        firstCard &&
        (firstCard.value === "wild" || firstCard.value === "draw4")
    );

    room.discard.push(firstCard);
    room.currentColor = firstCard.color;

    if (firstCard.value === "skip") {
        room.turn = 1 % room.players.length;
    } else if (firstCard.value === "reverse") {
        room.direction = -1;

        if (room.players.length === 2) {
            room.turn = 1;
        }
    } else if (firstCard.value === "draw2") {
        const next = 1 % room.players.length;
        room.players[next].hand.push(...drawCards(room, 2));
        room.turn = next;
    }

    emitRoomState(room);
}

function getPublicState(room, socketId) {
    return {
        code: room.code,
        started: room.started,
        currentColor: room.currentColor,
        discardTop: room.discard[room.discard.length - 1],
        turnPlayerId: room.players[room.turn]?.id || null,
        direction: room.direction,

        players: room.players.map(player => ({
            id: player.id,
            name: player.name,
            cardCount: player.hand.length
        })),

        yourHand: room.players.find(p => p.id === socketId)?.hand || []
    };
}

function emitRoomState(room) {
    for (const player of room.players) {
        io.to(player.id).emit("game_state", getPublicState(room, player.id));
    }
}

function getPlayer(room, socketId) {
    return room.players.find(player => player.id === socketId);
}

function canPlay(card, room) {
    const top = room.discard[room.discard.length - 1];

    if (card.color === "wild") {
        return true;
    }

    if (card.color === room.currentColor) {
        return true;
    }

    if (card.value === top.value) {
        return true;
    }

    return false;
}

function nextTurn(room, amount = 1) {
    const count = room.players.length;

    room.turn =
        (room.turn + room.direction * amount + count * 100) %
        count;
}

function finishGame(room, winner) {
    room.started = false;

    io.to(room.code).emit("game_over", {
        winner: winner.name
    });
}

io.on("connection", socket => {
    console.log("Player connected:", socket.id);

    socket.on("create_room", ({ name }) => {
        name = String(name || "Player").trim().slice(0, 20);

        const code = generateRoomCode();

        const room = {
            code,
            players: [],
            deck: [],
            discard: [],
            started: false,
            turn: 0,
            direction: 1,
            currentColor: null
        };

        rooms.set(code, room);

        room.players.push({
            id: socket.id,
            name,
            hand: []
        });

        socket.join(code);

        socket.emit("room_created", {
            code
        });

        emitRoomState(room);
    });

    socket.on("join_room", ({ code, name }) => {
        code = String(code || "").trim().toUpperCase();
        name = String(name || "Player").trim().slice(0, 20);

        const room = rooms.get(code);

        if (!room) {
            socket.emit("error_message", "Room not found.");
            return;
        }

        if (room.started) {
            socket.emit("error_message", "That game has already started.");
            return;
        }

        if (room.players.length >= 4) {
            socket.emit("error_message", "That room is full.");
            return;
        }

        if (
            room.players.some(
                player => player.name.toLowerCase() === name.toLowerCase()
            )
        ) {
            socket.emit("error_message", "That name is already being used.");
            return;
        }

        room.players.push({
            id: socket.id,
            name,
            hand: []
        });

        socket.join(code);

        socket.emit("room_joined", {
            code
        });

        emitRoomState(room);
    });

    socket.on("start_game", () => {
        const room = [...rooms.values()].find(room =>
            room.players.some(player => player.id === socket.id)
        );

        if (!room) return;

        if (room.players[0]?.id !== socket.id) {
            socket.emit("error_message", "Only the room host can start.");
            return;
        }

        if (room.players.length < 2) {
            socket.emit("error_message", "You need at least 2 players.");
            return;
        }

        if (room.started) return;

        startGame(room);
    });

    socket.on("play_card", ({ cardIndex, chosenColor }) => {
        const room = [...rooms.values()].find(room =>
            room.players.some(player => player.id === socket.id)
        );

        if (!room || !room.started) return;

        const player = getPlayer(room, socket.id);

        if (!player) return;

        if (room.players[room.turn].id !== socket.id) {
            socket.emit("error_message", "It isn't your turn.");
            return;
        }

        if (
            !Number.isInteger(cardIndex) ||
            cardIndex < 0 ||
            cardIndex >= player.hand.length
        ) {
            socket.emit("error_message", "Invalid card.");
            return;
        }

        const card = player.hand[cardIndex];

        if (!canPlay(card, room)) {
            socket.emit("error_message", "You can't play that card.");
            return;
        }

        if (
            card.color === "wild" &&
            !COLORS.includes(chosenColor)
        ) {
            socket.emit("error_message", "Choose a color.");
            return;
        }

        player.hand.splice(cardIndex, 1);

        room.discard.push(card);

        if (card.color === "wild") {
            room.currentColor = chosenColor;
        } else {
            room.currentColor = card.color;
        }

        if (player.hand.length === 0) {
            emitRoomState(room);
            finishGame(room, player);
            return;
        }

        if (card.value === "skip") {
            nextTurn(room, 2);
        } else if (card.value === "reverse") {
            room.direction *= -1;

            if (room.players.length === 2) {
                nextTurn(room, 2);
            } else {
                nextTurn(room, 1);
            }
        } else if (card.value === "draw2") {
            nextTurn(room, 1);

            const target = room.players[room.turn];
            target.hand.push(...drawCards(room, 2));

            nextTurn(room, 1);
        } else if (card.value === "draw4") {
            nextTurn(room, 1);

            const target = room.players[room.turn];
            target.hand.push(...drawCards(room, 4));

            nextTurn(room, 1);
        } else {
            nextTurn(room, 1);
        }

        emitRoomState(room);
    });

    socket.on("draw_card", () => {
        const room = [...rooms.values()].find(room =>
            room.players.some(player => player.id === socket.id)
        );

        if (!room || !room.started) return;

        const player = getPlayer(room, socket.id);

        if (!player) return;

        if (room.players[room.turn].id !== socket.id) {
            socket.emit("error_message", "It isn't your turn.");
            return;
        }

        const cards = drawCards(room, 1);

        if (cards.length) {
            player.hand.push(cards[0]);
        }

        nextTurn(room, 1);

        emitRoomState(room);
    });

    socket.on("disconnect", () => {
        console.log("Player disconnected:", socket.id);

        for (const [code, room] of rooms.entries()) {
            const index = room.players.findIndex(
                player => player.id === socket.id
            );

            if (index === -1) continue;

            room.players.splice(index, 1);

            if (room.players.length === 0) {
                rooms.delete(code);
                continue;
            }

            if (room.started) {
                room.started = false;

                io.to(code).emit(
                    "error_message",
                    "A player disconnected. The game has ended."
                );
            }

            room.turn = 0;

            emitRoomState(room);
        }
    });
});

app.get("/", (req, res) => {
    res.json({
        service: "Pulse UNO",
        status: "online"
    });
});

server.listen(PORT, () => {
    console.log(`Pulse UNO server running on port ${PORT}`);
});
