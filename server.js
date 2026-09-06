const express = require("express");
const http = require("http");
const cors = require("cors");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

app.use(cors({
    origin: "*"
}));

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

const UNO_WINDOW_MS = 3000;

function createDeck() {
    const deck = [];

    for (const color of COLORS) {
        deck.push({
            id: crypto.randomUUID(),
            color,
            value: "0"
        });

        for (let i = 1; i <= 9; i++) {
            deck.push({
                id: crypto.randomUUID(),
                color,
                value: String(i)
            });

            deck.push({
                id: crypto.randomUUID(),
                color,
                value: String(i)
            });
        }

        for (let i = 0; i < 2; i++) {
            deck.push({
                id: crypto.randomUUID(),
                color,
                value: "skip"
            });

            deck.push({
                id: crypto.randomUUID(),
                color,
                value: "reverse"
            });

            deck.push({
                id: crypto.randomUUID(),
                color,
                value: "draw2"
            });
        }
    }

    for (let i = 0; i < 4; i++) {
        deck.push({
            id: crypto.randomUUID(),
            color: "wild",
            value: "wild"
        });

        deck.push({
            id: crypto.randomUUID(),
            color: "wild",
            value: "draw4"
        });
    }

    return shuffle(deck);
}

function shuffle(array) {
    const copy = [...array];

    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));

        [copy[i], copy[j]] =
            [copy[j], copy[i]];
    }

    return copy;
}

function generateRoomCode() {
    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code;

    do {
        code = "";

        for (let i = 0; i < 6; i++) {
            code += chars[
                Math.floor(Math.random() * chars.length)
            ];
        }

    } while (rooms.has(code));

    return code;
}

function createPlayerId() {
    return crypto.randomUUID();
}

function drawCards(room, amount) {
    const cards = [];

    for (let i = 0; i < amount; i++) {
        if (room.deck.length === 0) {
            rebuildDeck(room);
        }

        if (room.deck.length === 0) {
            break;
        }

        cards.push(room.deck.pop());
    }

    return cards;
}

function rebuildDeck(room) {
    if (room.discard.length <= 1) {
        return;
    }

    const top =
        room.discard[room.discard.length - 1];

    const oldCards =
        room.discard.slice(0, -1);

    room.discard = [top];

    room.deck = shuffle(
        oldCards.filter(card =>
            card.value !== "wild" &&
            card.value !== "draw4"
        )
    );
}

function getRoomBySocket(socketId) {
    for (const room of rooms.values()) {
        if (
            room.players.some(
                player => player.socketId === socketId
            )
        ) {
            return room;
        }
    }

    return null;
}

function getPlayer(room, socketId) {
    return room.players.find(
        player => player.socketId === socketId
    );
}

function getPlayerById(room, playerId) {
    return room.players.find(
        player => player.id === playerId
    );
}

function currentPlayer(room) {
    return room.players[room.turn];
}

function nextTurn(room, amount = 1) {
    const count = room.players.length;

    room.turn =
        (
            room.turn +
            room.direction * amount +
            count * 100
        ) % count;
}

function canPlay(card, room) {
    const top =
        room.discard[room.discard.length - 1];

    if (!top) {
        return true;
    }

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

function isDrawCard(card) {
    return (
        card.value === "draw2" ||
        card.value === "draw4"
    );
}

function canStack(card, room) {
    if (!room.pendingDraw) {
        return false;
    }

    if (
        room.pendingDraw.type === "draw2" &&
        card.value === "draw2"
    ) {
        return true;
    }

    if (
        room.pendingDraw.type === "draw4" &&
        card.value === "draw4"
    ) {
        return true;
    }

    return false;
}

function advanceAfterCard(room, card) {
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

        room.pendingDraw = {
            type: "draw2",
            amount: room.pendingDraw
                ? room.pendingDraw.amount + 2
                : 2
        };

        nextTurn(room, 1);

    } else if (card.value === "draw4") {

        room.pendingDraw = {
            type: "draw4",
            amount: room.pendingDraw
                ? room.pendingDraw.amount + 4
                : 4
        };

        nextTurn(room, 1);

    } else {

        nextTurn(room, 1);
    }
}

function emitRoomState(room) {
    for (const player of room.players) {

        if (!player.socketId) {
            continue;
        }

        const state = {
            code: room.code,
            started: room.started,

            currentColor:
                room.currentColor,

            discardTop:
                room.discard[
                    room.discard.length - 1
                ] || null,

            turnPlayerId:
                currentPlayer(room)?.id || null,

            direction:
                room.direction,

            pendingDraw:
                room.pendingDraw
                    ? {
                        type: room.pendingDraw.type,
                        amount: room.pendingDraw.amount
                    }
                    : null,

            unoPlayerId:
                room.unoPlayerId || null,

            unoDeadline:
                room.unoDeadline || null,

            players:
                room.players.map(p => ({
                    id: p.id,
                    name: p.name,
                    cardCount: p.hand.length,
                    connected: Boolean(p.socketId)
                })),

            yourPlayerId:
                player.id,

            yourHand:
                player.hand
        };

        io.to(player.socketId)
            .emit("game_state", state);
    }
}

function resetUno(room) {
    room.unoPlayerId = null;
    room.unoDeadline = null;

    if (room.unoTimer) {
        clearTimeout(room.unoTimer);
        room.unoTimer = null;
    }
}

function startUnoWindow(room, player) {

    resetUno(room);

    if (player.hand.length !== 1) {
        return;
    }

    room.unoPlayerId = player.id;
    room.unoDeadline =
        Date.now() + UNO_WINDOW_MS;

    room.unoTimer = setTimeout(() => {

        if (
            room.unoPlayerId === player.id &&
            player.hand.length === 1
        ) {

            player.hand.push(
                ...drawCards(room, 2)
            );

            io.to(room.code).emit(
                "uno_penalty",
                {
                    player: player.name
                }
            );
        }

        resetUno(room);

        emitRoomState(room);

    }, UNO_WINDOW_MS);
}

function finishGame(room, winner) {

    room.started = false;

    resetUno(room);

    io.to(room.code).emit(
        "game_over",
        {
            winner: winner.name
        }
    );
}

function startGame(room) {

    room.deck = createDeck();
    room.discard = [];

    room.started = true;
    room.turn = 0;
    room.direction = 1;
    room.currentColor = null;
    room.pendingDraw = null;

    resetUno(room);

    for (const player of room.players) {
        player.hand = drawCards(room, 7);
    }

    let firstCard;

    do {
        firstCard = room.deck.pop();
    } while (
        firstCard &&
        (
            firstCard.value === "wild" ||
            firstCard.value === "draw4"
        )
    );

    room.discard.push(firstCard);
    room.currentColor = firstCard.color;

    if (firstCard.value === "skip") {

        nextTurn(room, 2);

    } else if (firstCard.value === "reverse") {

        room.direction *= -1;

        if (room.players.length === 2) {
            nextTurn(room, 2);
        } else {
            nextTurn(room, 1);
        }

    } else if (firstCard.value === "draw2") {

        nextTurn(room, 1);

        const target =
            currentPlayer(room);

        target.hand.push(
            ...drawCards(room, 2)
        );

        nextTurn(room, 1);

    } else {

        room.turn = 0;
    }

    emitRoomState(room);
}

io.on("connection", socket => {

    console.log(
        "Player connected:",
        socket.id
    );

    /*
     * CREATE ROOM
     */

    socket.on("create_room", ({ name }) => {

        name =
            String(name || "Player")
                .trim()
                .slice(0, 20);

        const code =
            generateRoomCode();

        const player = {
            id: createPlayerId(),
            socketId: socket.id,
            name,
            hand: []
        };

        const room = {
            code,

            players: [
                player
            ],

            deck: [],
            discard: [],

            started: false,

            turn: 0,
            direction: 1,

            currentColor: null,

            pendingDraw: null,

            unoPlayerId: null,
            unoDeadline: null,
            unoTimer: null
        };

        rooms.set(code, room);

        socket.join(code);

        socket.emit(
            "room_created",
            {
                code,
                playerId: player.id
            }
        );

        emitRoomState(room);
    });

    /*
     * JOIN
     */

    socket.on("join_room", ({ code, name }) => {

        code =
            String(code || "")
                .trim()
                .toUpperCase();

        name =
            String(name || "Player")
                .trim()
                .slice(0, 20);

        const room =
            rooms.get(code);

        if (!room) {
            socket.emit(
                "error_message",
                "Room not found."
            );

            return;
        }

        if (room.started) {
            socket.emit(
                "error_message",
                "That game has already started."
            );

            return;
        }

        if (room.players.length >= 4) {
            socket.emit(
                "error_message",
                "That room is full."
            );

            return;
        }

        if (
            room.players.some(
                player =>
                    player.name.toLowerCase() ===
                    name.toLowerCase()
            )
        ) {
            socket.emit(
                "error_message",
                "That name is already being used."
            );

            return;
        }

        const player = {
            id: createPlayerId(),
            socketId: socket.id,
            name,
            hand: []
        };

        room.players.push(player);

        socket.join(code);

        socket.emit(
            "room_joined",
            {
                code,
                playerId: player.id
            }
        );

        emitRoomState(room);
    });

    /*
     * START
     */

    socket.on("start_game", () => {

        const room =
            getRoomBySocket(socket.id);

        if (!room) return;

        const player =
            getPlayer(room, socket.id);

        if (!player) return;

        if (
            room.players[0].id !==
            player.id
        ) {
            socket.emit(
                "error_message",
                "Only the host can start the game."
            );

            return;
        }

        if (room.players.length < 2) {
            socket.emit(
                "error_message",
                "You need at least 2 players."
            );

            return;
        }

        if (room.started) return;

        startGame(room);
    });

    /*
     * PLAY CARD
     */

    socket.on(
        "play_card",
        ({ cardIndex, chosenColor }) => {

            const room =
                getRoomBySocket(socket.id);

            if (!room || !room.started) {
                return;
            }

            const player =
                getPlayer(room, socket.id);

            if (!player) return;

            if (
                currentPlayer(room)?.id !==
                player.id
            ) {
                socket.emit(
                    "error_message",
                    "It isn't your turn."
                );

                return;
            }

            if (
                !Number.isInteger(cardIndex) ||
                cardIndex < 0 ||
                cardIndex >= player.hand.length
            ) {
                socket.emit(
                    "error_message",
                    "Invalid card."
                );

                return;
            }

            const card =
                player.hand[cardIndex];

            if (
                room.pendingDraw &&
                !canStack(card, room)
            ) {
                socket.emit(
                    "error_message",
                    `You must draw ${room.pendingDraw.amount} cards or stack a matching draw card.`
                );

                return;
            }

            if (
                !room.pendingDraw &&
                !canPlay(card, room)
            ) {
                socket.emit(
                    "error_message",
                    "You can't play that card."
                );

                return;
            }

            if (
                card.color === "wild" &&
                !COLORS.includes(chosenColor)
            ) {
                socket.emit(
                    "error_message",
                    "Choose a color."
                );

                return;
            }

            player.hand.splice(
                cardIndex,
                1
            );

            room.discard.push(card);

            if (card.color === "wild") {
                room.currentColor =
                    chosenColor;
            } else {
                room.currentColor =
                    card.color;
            }

            const previousPending =
                room.pendingDraw;

            room.pendingDraw = null;

            if (player.hand.length === 0) {
                emitRoomState(room);

                finishGame(
                    room,
                    player
                );

                return;
            }

            if (player.hand.length === 1) {
                startUnoWindow(
                    room,
                    player
                );
            } else {
                resetUno(room);
            }

            /*
             * If a draw card was stacked,
             * preserve its accumulated amount.
             */

            if (
                previousPending &&
                isDrawCard(card)
            ) {
                room.pendingDraw = {
                    type: card.value,
                    amount:
                        previousPending.amount +
                        (
                            card.value === "draw2"
                                ? 2
                                : 4
                        )
                };

                nextTurn(room, 1);

            } else {

                advanceAfterCard(
                    room,
                    card
                );
            }

            emitRoomState(room);
        }
    );

    /*
     * DRAW
     */

    socket.on("draw_card", () => {

        const room =
            getRoomBySocket(socket.id);

        if (!room || !room.started) {
            return;
        }

        const player =
            getPlayer(room, socket.id);

        if (!player) return;

        if (
            currentPlayer(room)?.id !==
            player.id
        ) {
            socket.emit(
                "error_message",
                "It isn't your turn."
            );

            return;
        }

        let amount = 1;

        if (room.pendingDraw) {
            amount =
                room.pendingDraw.amount;

            room.pendingDraw = null;
        }

        player.hand.push(
            ...drawCards(room, amount)
        );

        resetUno(room);

        nextTurn(room, 1);

        emitRoomState(room);
    });

    /*
     * UNO
     */

    socket.on("call_uno", () => {

        const room =
            getRoomBySocket(socket.id);

        if (!room || !room.started) {
            return;
        }

        const player =
            getPlayer(room, socket.id);

        if (!player) return;

        if (player.hand.length !== 1) {
            socket.emit(
                "error_message",
                "You can only call UNO with one card."
            );

            return;
        }

        if (
            room.unoPlayerId ===
            player.id
        ) {
            socket.emit(
                "uno_success"
            );

            return;
        }

        room.unoPlayerId =
            player.id;

        room.unoDeadline =
            Date.now() +
            UNO_WINDOW_MS;

        io.to(room.code).emit(
            "uno_called",
            {
                player: player.name
            }
        );

        emitRoomState(room);
    });

    /*
     * NEW GAME
     */

    socket.on("new_game", () => {

        const room =
            getRoomBySocket(socket.id);

        if (!room) return;

        const player =
            getPlayer(room, socket.id);

        if (!player) return;

        if (
            room.players[0].id !==
            player.id
        ) {
            return;
        }

        if (
            room.players.length < 2
        ) {
            return;
        }

        startGame(room);
    });

    /*
     * DISCONNECT
     */

    socket.on("disconnect", () => {

        console.log(
            "Player disconnected:",
            socket.id
        );

        const room =
            getRoomBySocket(socket.id);

        if (!room) return;

        const player =
            getPlayer(room, socket.id);

        if (!player) return;

        /*
         * Give the player a short
         * reconnect window.
         */

        player.socketId = null;

        io.to(room.code).emit(
            "player_disconnected",
            {
                player: player.name
            }
        );

        setTimeout(() => {

            const stillDisconnected =
                !player.socketId;

            if (!stillDisconnected) {
                return;
            }

            const index =
                room.players.indexOf(player);

            if (index !== -1) {
                room.players.splice(
                    index,
                    1
                );
            }

            if (
                room.players.length === 0
            ) {
                if (room.unoTimer) {
                    clearTimeout(
                        room.unoTimer
                    );
                }

                rooms.delete(
                    room.code
                );

                return;
            }

            if (room.started) {
                room.started = false;

                io.to(room.code).emit(
                    "error_message",
                    "A player left. The game has ended."
                );
            }

            room.turn = 0;

            emitRoomState(room);

        }, 30000);
    });

    /*
     * RECONNECT
     */

    socket.on(
        "reconnect_player",
        ({ code, playerId }) => {

            const room =
                rooms.get(
                    String(code || "")
                        .toUpperCase()
                );

            if (!room) {
                socket.emit(
                    "error_message",
                    "Game room no longer exists."
                );

                return;
            }

            const player =
                getPlayerById(
                    room,
                    playerId
                );

            if (!player) {
                socket.emit(
                    "error_message",
                    "Player session not found."
                );

                return;
            }

            player.socketId =
                socket.id;

            socket.join(room.code);

            socket.emit(
                "reconnected"
            );

            emitRoomState(room);
        }
    );
});

app.get("/", (req, res) => {
    res.json({
        service: "Pulse UNO",
        status: "online",
        rooms: rooms.size
    });
});

server.listen(PORT, () => {
    console.log(
        `Pulse UNO running on port ${PORT}`
    );
});
