const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

/* =========================================================
   HELPERS
========================================================= */

function makeId() {
    return crypto.randomBytes(8).toString("hex");
}

function makeRoomCode() {
    let code;

    do {
        code = crypto.randomBytes(3)
            .toString("hex")
            .toUpperCase();
    } while (rooms.has(code));

    return code;
}

function escapeHtml(value = "") {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function redirect(res, room, player) {
    res.redirect(
        `/game?room=${encodeURIComponent(room)}&player=${encodeURIComponent(player)}`
    );
}

function getRoom(code) {
    return rooms.get(String(code || "").toUpperCase());
}

function getPlayer(room, id) {
    return room?.players.find(p => p.id === id);
}

function currentPlayer(room) {
    return room.players[room.turnIndex];
}

/* =========================================================
   UNO DECK
========================================================= */

const colors = ["red", "yellow", "green", "blue"];

function createDeck() {
    const deck = [];

    for (const color of colors) {
        deck.push({
            id: makeId(),
            color,
            value: "0"
        });

        for (let i = 1; i <= 9; i++) {
            deck.push({
                id: makeId(),
                color,
                value: String(i)
            });

            deck.push({
                id: makeId(),
                color,
                value: String(i)
            });
        }

        for (let i = 0; i < 2; i++) {
            deck.push({
                id: makeId(),
                color,
                value: "skip"
            });

            deck.push({
                id: makeId(),
                color,
                value: "reverse"
            });

            deck.push({
                id: makeId(),
                color,
                value: "draw2"
            });
        }
    }

    for (let i = 0; i < 4; i++) {
        deck.push({
            id: makeId(),
            color: "wild",
            value: "wild"
        });

        deck.push({
            id: makeId(),
            color: "wild",
            value: "wild4"
        });
    }

    return deck;
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }

    return array;
}

/* =========================================================
   DRAWING
========================================================= */

function drawFromDeck(room) {
    if (room.deck.length === 0) {
        if (room.discard.length <= 1) {
            return null;
        }

        const top = room.discard.pop();

        room.deck = shuffle(room.discard);
        room.discard = [top];
    }

    return room.deck.pop();
}

function drawCards(room, player, amount) {
    for (let i = 0; i < amount; i++) {
        const card = drawFromDeck(room);

        if (!card) break;

        player.hand.push(card);
    }
}

/* =========================================================
   TURN LOGIC
========================================================= */

function nextTurn(room, amount = 1) {
    room.turnIndex =
        (room.turnIndex + amount + room.players.length) %
        room.players.length;
}

function isPlayable(card, room) {
    const top = room.discard[room.discard.length - 1];

    if (!top) return true;

    if (card.color === "wild") {
        if (card.value === "wild4") {
            return room.drawStack === 0;
        }

        return true;
    }

    if (room.drawStack > 0) {
        return card.value === "draw2";
    }

    return (
        card.color === top.color ||
        card.value === top.value
    );
}

/* =========================================================
   START GAME
========================================================= */

function startGame(room) {
    room.deck = shuffle(createDeck());
    room.discard = [];
    room.turnIndex = 0;
    room.drawStack = 0;
    room.winner = null;
    room.message = "";

    for (const player of room.players) {
        player.hand = [];
        player.saidUno = false;
    }

    for (let i = 0; i < 7; i++) {
        for (const player of room.players) {
            const card = drawFromDeck(room);

            if (card) {
                player.hand.push(card);
            }
        }
    }

    let firstCard;

    while (room.deck.length > 0) {
        firstCard = drawFromDeck(room);

        if (!firstCard) break;

        if (firstCard.color !== "wild") {
            break;
        }

        room.deck.unshift(firstCard);
        shuffle(room.deck);
    }

    if (firstCard) {
        room.discard.push(firstCard);
    }

    room.started = true;
}

/* =========================================================
   HTML
========================================================= */

function page(title, content, refresh = false) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

${refresh ? `<meta http-equiv="refresh" content="3">` : ""}

<title>${escapeHtml(title)}</title>

<link rel="stylesheet" href="/style.css">
</head>

<body>

<header class="topbar">

    <div class="brand">
        <div class="brand-p">P</div>

        <div class="brand-name">
            Pulse <span>UNO</span>
        </div>
    </div>

</header>

<main>

${content}

</main>

</body>
</html>`;
}

function cardText(card) {
    switch (card.value) {
        case "skip":
            return "⊘";

        case "reverse":
            return "↻";

        case "draw2":
            return "+2";

        case "wild":
            return "WILD";

        case "wild4":
            return "+4";

        default:
            return card.value;
    }
}

function cardClass(card) {
    return `uno-card ${card.color}`;
}

/* =========================================================
   HOME
========================================================= */

app.get("/", (req, res) => {
    res.send(
        page(
            "Pulse UNO",
            `
<section class="center-page">

    <div class="panel home-panel">

        <div class="uno-logo">
            UNO
        </div>

        <div class="eyebrow">
            PULSE SUITE
        </div>

        <h1>Pulse UNO</h1>

        <p class="subtitle">
            Play UNO with your friends.
        </p>

        <form action="/create" method="POST">

            <label>
                YOUR NAME
            </label>

            <input
                name="name"
                maxlength="20"
                required
                autocomplete="nickname"
                placeholder="Enter your name"
            >

            <button class="button primary">
                CREATE ROOM
            </button>

        </form>

        <div class="or">
            <span></span>
            OR
            <span></span>
        </div>

        <form action="/join" method="POST">

            <label>
                ROOM CODE
            </label>

            <input
                name="room"
                maxlength="8"
                required
                autocomplete="off"
                placeholder="Enter room code"
            >

            <label>
                YOUR NAME
            </label>

            <input
                name="name"
                maxlength="20"
                required
                autocomplete="nickname"
                placeholder="Enter your name"
            >

            <button class="button secondary">
                JOIN ROOM
            </button>

        </form>

        <div class="pulse-suite">
            <span class="suite-dot"></span>
            Pulse Suite
        </div>

    </div>

</section>
`
        )
    );
});

/* =========================================================
   CREATE
========================================================= */

app.post("/create", (req, res) => {
    const name = String(req.body.name || "")
        .trim()
        .slice(0, 20);

    if (!name) {
        return res.status(400).send(
            page(
                "Pulse UNO — Error",
                `
                <section class="center-page">
                    <div class="panel message-panel">
                        <div class="error-icon">!</div>
                        <h1>Name required</h1>
                        <p class="subtitle">Please enter your name.</p>
                        <a class="button primary" href="/">GO BACK</a>
                    </div>
                </section>
                `
            )
        );
    }

    const code = makeRoomCode();

    const player = {
        id: makeId(),
        name,
        hand: [],
        saidUno: false,
        host: true
    };

    rooms.set(code, {
        code,
        hostId: player.id,
        players: [player],
        started: false,
        deck: [],
        discard: [],
        turnIndex: 0,
        drawStack: 0,
        winner: null,
        message: ""
    });

    redirect(res, code, player.id);
});

/* =========================================================
   JOIN
========================================================= */

app.post("/join", (req, res) => {
    const roomCode = String(req.body.room || "")
        .trim()
        .toUpperCase();

    const name = String(req.body.name || "")
        .trim()
        .slice(0, 20);

    const room = getRoom(roomCode);

    if (!room) {
        return res.status(404).send(
            page(
                "Pulse UNO — Room Not Found",
                `
                <section class="center-page">
                    <div class="panel message-panel">
                        <div class="error-icon">?</div>
                        <h1>Room not found</h1>
                        <p class="subtitle">
                            That room code doesn't exist.
                        </p>
                        <a class="button primary" href="/">GO BACK</a>
                    </div>
                </section>
                `
            )
        );
    }

    if (room.started) {
        return res.status(400).send(
            page(
                "Pulse UNO — Game Started",
                `
                <section class="center-page">
                    <div class="panel message-panel">
                        <div class="error-icon">!</div>
                        <h1>Game already started</h1>
                        <p class="subtitle">
                            You can't join this room right now.
                        </p>
                        <a class="button primary" href="/">GO BACK</a>
                    </div>
                </section>
                `
            )
        );
    }

    if (room.players.length >= 4) {
        return res.status(400).send(
            page(
                "Pulse UNO — Room Full",
                `
                <section class="center-page">
                    <div class="panel message-panel">
                        <div class="error-icon">4</div>
                        <h1>Room is full</h1>
                        <p class="subtitle">
                            UNO rooms can have up to four players.
                        </p>
                        <a class="button primary" href="/">GO BACK</a>
                    </div>
                </section>
                `
            )
        );
    }

    if (!name) {
        return res.status(400).send(
            page(
                "Pulse UNO — Error",
                `
                <section class="center-page">
                    <div class="panel message-panel">
                        <div class="error-icon">!</div>
                        <h1>Name required</h1>
                        <p class="subtitle">Please enter your name.</p>
                        <a class="button primary" href="/">GO BACK</a>
                    </div>
                </section>
                `
            )
        );
    }

    const player = {
        id: makeId(),
        name,
        hand: [],
        saidUno: false,
        host: false
    };

    room.players.push(player);

    redirect(res, room.code, player.id);
});

/* =========================================================
   GAME PAGE
========================================================= */

app.get("/game", (req, res) => {
    const room = getRoom(req.query.room);
    const player = getPlayer(room, req.query.player);

    if (!room || !player) {
        return res.redirect("/");
    }

    if (!room.started) {
        return res.send(
            page(
                `Pulse UNO — ${room.code}`,
                renderLobby(room, player),
                true
            )
        );
    }

    res.send(
        page(
            `Pulse UNO — ${room.code}`,
            renderGame(room, player),
            true
        )
    );
});

/* =========================================================
   LOBBY
========================================================= */

function renderLobby(room, player) {
    return `
<section class="center-page">

    <div class="panel lobby-panel">

        <div class="eyebrow">
            GAME LOBBY
        </div>

        <h1>Room Ready</h1>

        <p class="subtitle">
            Share this code with your friends.
        </p>

        <div class="room-code">
            ${escapeHtml(room.code)}
        </div>

        <div class="players-title">
            PLAYERS
            <span>${room.players.length}/4</span>
        </div>

        <div class="player-list">

            ${room.players.map((p, index) => `
                <div class="player-row">

                    <div class="player-avatar">
                        ${escapeHtml(p.name.charAt(0).toUpperCase())}
                    </div>

                    <div class="player-info">
                        <strong>${escapeHtml(p.name)}</strong>
                        ${
                            p.host
                                ? `<small>HOST</small>`
                                : `<small>PLAYER ${index + 1}</small>`
                        }
                    </div>

                </div>
            `).join("")}

        </div>

        ${
            player.host
                ? `
                    <form action="/start" method="POST">
                        <input type="hidden" name="room" value="${escapeHtml(room.code)}">
                        <input type="hidden" name="player" value="${escapeHtml(player.id)}">

                        <button class="button primary">
                            START GAME
                        </button>
                    </form>
                `
                : `
                    <div class="waiting">
                        <span class="pulse-loader"></span>
                        Waiting for the host to start...
                    </div>
                `
        }

        <a href="/" class="back-link">
            ← Leave room
        </a>

    </div>

</section>
`;
}

/* =========================================================
   START
========================================================= */

app.post("/start", (req, res) => {
    const room = getRoom(req.body.room);
    const player = getPlayer(room, req.body.player);

    if (!room || !player || room.hostId !== player.id) {
        return res.redirect("/");
    }

    if (room.players.length < 2) {
        return res.status(400).send(
            page(
                "Pulse UNO — Need Players",
                `
                <section class="center-page">
                    <div class="panel message-panel">
                        <div class="error-icon">2</div>
                        <h1>Need another player</h1>
                        <p class="subtitle">
                            You need at least two players to start.
                        </p>
                        <a class="button primary"
                           href="/game?room=${encodeURIComponent(room.code)}&player=${encodeURIComponent(player.id)}">
                           BACK TO ROOM
                        </a>
                    </div>
                </section>
                `
            )
        );
    }

    startGame(room);

    redirect(res, room.code, player.id);
});

/* =========================================================
   PLAY CARD
========================================================= */

app.post("/play", (req, res) => {
    const room = getRoom(req.body.room);
    const player = getPlayer(room, req.body.player);

    if (!room || !player || !room.started) {
        return res.redirect("/");
    }

    if (room.winner) {
        return redirect(res, room.code, player.id);
    }

    if (currentPlayer(room).id !== player.id) {
        return redirect(res, room.code, player.id);
    }

    const cardIndex = Number(req.body.card);

    if (
        !Number.isInteger(cardIndex) ||
        cardIndex < 0 ||
        cardIndex >= player.hand.length
    ) {
        return redirect(res, room.code, player.id);
    }

    const card = player.hand[cardIndex];

    if (!isPlayable(card, room)) {
        return res.send(
            page(
                "Pulse UNO — Invalid Move",
                `
                <section class="center-page">
                    <div class="panel message-panel">
                        <div class="error-icon">×</div>
                        <h1>Can't play that card</h1>
                        <p class="subtitle">
                            Choose a card matching the color, number,
                            symbol, or a wild card.
                        </p>

                        <a class="button primary"
                           href="/game?room=${encodeURIComponent(room.code)}&player=${encodeURIComponent(player.id)}">
                           BACK TO GAME
                        </a>
                    </div>
                </section>
                `
            )
        );
    }

    player.hand.splice(cardIndex, 1);

    room.discard.push(card);

    if (card.value === "draw2") {
        room.drawStack += 2;
    } else if (card.value !== "wild4") {
        if (room.drawStack > 0) {
            room.drawStack = 0;
        }
    }

    if (card.color === "wild") {
        if (card.value === "wild4") {
            room.drawStack += 4;
        }

        room.pendingWild = {
            playerId: player.id,
            cardId: card.id
        };

        return redirect(res, room.code, player.id);
    }

    if (player.hand.length === 0) {
        room.winner = player.name;
        room.message = `${player.name} won the game!`;
        return redirect(res, room.code, player.id);
    }

    player.saidUno = player.hand.length === 1;

    nextTurn(room);

    redirect(res, room.code, player.id);
});

/* =========================================================
   WILD CHOICE
========================================================= */

app.post("/wild", (req, res) => {
    const room = getRoom(req.body.room);
    const player = getPlayer(room, req.body.player);

    if (!room || !player || !room.started) {
        return res.redirect("/");
    }

    if (
        !room.pendingWild ||
        room.pendingWild.playerId !== player.id
    ) {
        return redirect(res, room.code, player.id);
    }

    const color = String(req.body.color || "");

    if (!colors.includes(color)) {
        return redirect(res, room.code, player.id);
    }

    const top = room.discard[room.discard.length - 1];

    top.color = color;
    top.wildColor = color;

    room.pendingWild = null;

    if (player.hand.length === 0) {
        room.winner = player.name;
        room.message = `${player.name} won the game!`;
        return redirect(res, room.code, player.id);
    }

    player.saidUno = player.hand.length === 1;

    nextTurn(room);

    redirect(res, room.code, player.id);
});

/* =========================================================
   DRAW
========================================================= */

app.post("/draw", (req, res) => {
    const room = getRoom(req.body.room);
    const player = getPlayer(room, req.body.player);

    if (!room || !player || !room.started) {
        return res.redirect("/");
    }

    if (room.winner || currentPlayer(room).id !== player.id) {
        return redirect(res, room.code, player.id);
    }

    const amount = room.drawStack > 0 ? room.drawStack : 1;

    drawCards(room, player, amount);

    room.drawStack = 0;

    nextTurn(room);

    redirect(res, room.code, player.id);
});

/* =========================================================
   UNO
========================================================= */

app.post("/uno", (req, res) => {
    const room = getRoom(req.body.room);
    const player = getPlayer(room, req.body.player);

    if (!room || !player || !room.started) {
        return res.redirect("/");
    }

    if (player.hand.length === 1) {
        player.saidUno = true;
    }

    redirect(res, room.code, player.id);
});

/* =========================================================
   NEW GAME
========================================================= */

app.post("/new-game", (req, res) => {
    const room = getRoom(req.body.room);
    const player = getPlayer(room, req.body.player);

    if (!room || !player || room.hostId !== player.id) {
        return res.redirect("/");
    }

    startGame(room);

    redirect(res, room.code, player.id);
});

/* =========================================================
   GAME RENDER
========================================================= */

function renderGame(room, player) {
    const current = currentPlayer(room);
    const top = room.discard[room.discard.length - 1];

    if (room.winner) {
        return `
<section class="center-page">

    <div class="panel winner-panel">

        <div class="winner-badge">
            🏆
        </div>

        <div class="eyebrow">
            GAME OVER
        </div>

        <h1>${escapeHtml(room.winner)} WINS!</h1>

        <p class="subtitle">
            That was a clean UNO victory.
        </p>

        ${
            player.host
                ? `
                <form action="/new-game" method="POST">
                    <input type="hidden" name="room" value="${escapeHtml(room.code)}">
                    <input type="hidden" name="player" value="${escapeHtml(player.id)}">

                    <button class="button primary">
                        PLAY AGAIN
                    </button>
                </form>
                `
                : `
                <div class="waiting">
                    Waiting for the host...
                </div>
                `
        }

        <a href="/" class="back-link">
            ← Leave room
        </a>

    </div>

</section>
`;
    }

    if (room.pendingWild && room.pendingWild.playerId === player.id) {
        return renderWildChoice(room, player);
    }

    const yourTurn = current.id === player.id;

    return `
<section class="game-page">

    <div class="game-header">

        <div>
            <div class="eyebrow">
                ROOM
            </div>

            <div class="mini-room-code">
                ${escapeHtml(room.code)}
            </div>
        </div>

        <div class="turn-indicator ${yourTurn ? "your-turn" : ""}">
            ${
                yourTurn
                    ? "YOUR TURN"
                    : `${escapeHtml(current.name)}'S TURN`
            }
        </div>

    </div>

    <div class="table">

        <div class="opponents">

            ${room.players
                .filter(p => p.id !== player.id)
                .map(p => `
                    <div class="opponent ${p.id === current.id ? "active-opponent" : ""}">

                        <div class="opponent-avatar">
                            ${escapeHtml(p.name.charAt(0).toUpperCase())}
                        </div>

                        <div>
                            <strong>${escapeHtml(p.name)}</strong>
                            <small>
                                ${p.hand.length} card${p.hand.length === 1 ? "" : "s"}
                            </small>
                        </div>

                    </div>
                `)
                .join("")}

        </div>

        <div class="center-cards">

            <div class="discard-label">
                DISCARD
            </div>

            ${
                top
                    ? `
                    <div class="${cardClass(top)} large-card">
                        <span class="card-corner">
                            ${escapeHtml(cardText(top))}
                        </span>

                        <span class="card-center">
                            ${escapeHtml(cardText(top))}
                        </span>

                        <span class="card-corner bottom">
                            ${escapeHtml(cardText(top))}
                        </span>
                    </div>
                    `
                    : ""
            }

            ${
                room.drawStack > 0
                    ? `
                    <div class="draw-stack">
                        +${room.drawStack} TO DRAW
                    </div>
                    `
                    : ""
            }

        </div>

    </div>

    <div class="your-area">

        <div class="hand-header">

            <div>
                <div class="eyebrow">
                    YOUR HAND
                </div>

                <h2>
                    ${player.hand.length} CARD${player.hand.length === 1 ? "" : "S"}
                </h2>
            </div>

            ${
                yourTurn && player.hand.length === 1
                    ? `
                    <form action="/uno" method="POST">
                        <input type="hidden" name="room" value="${escapeHtml(room.code)}">
                        <input type="hidden" name="player" value="${escapeHtml(player.id)}">

                        <button class="uno-button">
                            UNO!
                        </button>
                    </form>
                    `
                    : ""
            }

        </div>

        <div class="hand">

            ${player.hand
                .map((card, index) => `
                    ${
                        yourTurn && isPlayable(card, room)
                            ? `
                            <form action="/play" method="POST" class="card-form">

                                <input type="hidden" name="room" value="${escapeHtml(room.code)}">
                                <input type="hidden" name="player" value="${escapeHtml(player.id)}">
                                <input type="hidden" name="card" value="${index}">

                                <button
                                    class="${cardClass(card)} hand-card"
                                    title="Play ${escapeHtml(cardText(card))}"
                                >

                                    <span class="card-corner">
                                        ${escapeHtml(cardText(card))}
                                    </span>

                                    <span class="card-center">
                                        ${escapeHtml(cardText(card))}
                                    </span>

                                    <span class="card-corner bottom">
                                        ${escapeHtml(cardText(card))}
                                    </span>

                                </button>

                            </form>
                            `
                            : `
                            <div class="${cardClass(card)} hand-card disabled">

                                <span class="card-corner">
                                    ${escapeHtml(cardText(card))}
                                </span>

                                <span class="card-center">
                                    ${escapeHtml(cardText(card))}
                                </span>

                                <span class="card-corner bottom">
                                    ${escapeHtml(cardText(card))}
                                </span>

                            </div>
                            `
                    }
                `)
                .join("")}

        </div>

        <div class="game-actions">

            ${
                yourTurn
                    ? `
                    <form action="/draw" method="POST">

                        <input type="hidden" name="room" value="${escapeHtml(room.code)}">
                        <input type="hidden" name="player" value="${escapeHtml(player.id)}">

                        <button class="button secondary">
                            DRAW ${room.drawStack > 0 ? `+${room.drawStack}` : "CARD"}
                        </button>

                    </form>
                    `
                    : ""
            }

        </div>

    </div>

</section>
`;
}

/* =========================================================
   WILD COLOR
========================================================= */

function renderWildChoice(room, player) {
    return `
<section class="center-page">

    <div class="panel wild-panel">

        <div class="wild-symbol">
            🌈
        </div>

        <div class="eyebrow">
            WILD CARD
        </div>

        <h1>Choose a Color</h1>

        <p class="subtitle">
            Pick the color that continues the game.
        </p>

        <form action="/wild" method="POST">

            <input type="hidden" name="room" value="${escapeHtml(room.code)}">
            <input type="hidden" name="player" value="${escapeHtml(player.id)}">

            <div class="wild-grid">

                <button class="color-choice red-choice"
                        name="color"
                        value="red">
                    RED
                </button>

                <button class="color-choice yellow-choice"
                        name="color"
                        value="yellow">
                    YELLOW
                </button>

                <button class="color-choice green-choice"
                        name="color"
                        value="green">
                    GREEN
                </button>

                <button class="color-choice blue-choice"
                        name="color"
                        value="blue">
                    BLUE
                </button>

            </div>

        </form>

    </div>

</section>
`;
}

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (req, res) => {
    res.json({
        ok: true,
        service: "Pulse UNO",
        status: "online",
        rooms: rooms.size,
        uptime: process.uptime()
    });
});

/* =========================================================
   START SERVER
========================================================= */

app.listen(PORT, () => {
    console.log("========================================");
    console.log("Pulse UNO server running");
    console.log(`Port: ${PORT}`);
    console.log("JavaScript-free frontend");
    console.log("========================================");
});
