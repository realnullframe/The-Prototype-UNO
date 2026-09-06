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

function makeId(length = 12) {
    return crypto.randomBytes(length).toString("hex");
}

function makeRoomCode() {
    let code;

    do {
        code = crypto
            .randomBytes(4)
            .toString("hex")
            .toUpperCase();
    } while (rooms.has(code));

    return code;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function redirect(res, roomCode, playerId) {
    res.redirect(
        `/game?room=${encodeURIComponent(roomCode)}&player=${encodeURIComponent(playerId)}`
    );
}

/* =========================================================
   DECK
========================================================= */

const COLORS = ["red", "yellow", "green", "blue"];

function createDeck() {
    const deck = [];

    for (const color of COLORS) {

        // One zero
        deck.push({
            color,
            type: "number",
            value: 0
        });

        // Two of 1–9
        for (let value = 1; value <= 9; value++) {
            deck.push({
                color,
                type: "number",
                value
            });

            deck.push({
                color,
                type: "number",
                value
            });
        }

        // Action cards
        for (let i = 0; i < 2; i++) {
            deck.push({
                color,
                type: "skip"
            });

            deck.push({
                color,
                type: "reverse"
            });

            deck.push({
                color,
                type: "draw2"
            });
        }
    }

    // Wilds
    for (let i = 0; i < 4; i++) {
        deck.push({
            color: null,
            type: "wild"
        });

        deck.push({
            color: null,
            type: "wild4"
        });
    }

    return deck;
}

function shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));

        [deck[i], deck[j]] =
            [deck[j], deck[i]];
    }

    return deck;
}

/* =========================================================
   ROOM / GAME
========================================================= */

function createRoom(name) {

    const roomCode = makeRoomCode();
    const playerId = makeId();

    const room = {
        code: roomCode,
        hostId: playerId,

        players: [
            {
                id: playerId,
                name,
                hand: [],
                connected: true,
                saidUno: false
            }
        ],

        deck: [],
        discard: [],
        currentColor: null,

        turnIndex: 0,
        started: false,

        drawStack: 0,

        winner: null
    };

    rooms.set(roomCode, room);

    return {
        room,
        playerId
    };
}

function getRoom(code) {
    return rooms.get(
        String(code || "").toUpperCase()
    );
}

function getPlayer(room, playerId) {
    return room.players.find(
        player => player.id === playerId
    );
}

function currentPlayer(room) {
    return room.players[room.turnIndex];
}

/* =========================================================
   DRAWING / DISCARD
========================================================= */

function drawFromDeck(room) {

    if (room.deck.length === 0) {

        if (room.discard.length <= 1) {
            return null;
        }

        const top =
            room.discard.pop();

        room.deck =
            shuffle(room.discard);

        room.discard = [top];
    }

    return room.deck.pop();
}

function drawCards(room, player, amount) {

    const drawn = [];

    for (let i = 0; i < amount; i++) {

        const card =
            drawFromDeck(room);

        if (!card) break;

        player.hand.push(card);
        drawn.push(card);
    }

    return drawn;
}

/* =========================================================
   TURN
========================================================= */

function nextTurn(room, amount = 1) {

    const count =
        room.players.length;

    room.turnIndex =
        (room.turnIndex + amount + count) % count;

    const next =
        currentPlayer(room);

    if (next) {
        next.saidUno = false;
    }
}

/* =========================================================
   PLAYABILITY
========================================================= */

function isPlayable(room, card) {

    if (!room.discard.length) {
        return true;
    }

    const top =
        room.discard[room.discard.length - 1];

    // Stacking
    if (room.drawStack > 0) {

        if (top.type === "draw2") {
            return card.type === "draw2";
        }

        if (top.type === "wild4") {
            return card.type === "wild4";
        }
    }

    // Wild
    if (
        card.type === "wild" ||
        card.type === "wild4"
    ) {
        return true;
    }

    // Color
    if (
        card.color === room.currentColor
    ) {
        return true;
    }

    // Same action
    if (
        card.type === top.type &&
        card.type !== "number"
    ) {
        return true;
    }

    // Same number
    if (
        card.type === "number" &&
        top.type === "number" &&
        card.value === top.value
    ) {
        return true;
    }

    return false;
}

/* =========================================================
   GAME START
========================================================= */

function startGame(room) {

    room.deck =
        shuffle(createDeck());

    room.discard = [];
    room.currentColor = null;
    room.turnIndex = 0;
    room.drawStack = 0;
    room.winner = null;

    for (const player of room.players) {

        player.hand = [];
        player.saidUno = false;

        drawCards(room, player, 7);
    }

    // Find a non-wild starting card
    let startingCard;

    while (room.deck.length) {

        const card =
            room.deck.pop();

        if (
            card.type === "number" ||
            card.type === "skip" ||
            card.type === "reverse" ||
            card.type === "draw2"
        ) {
            startingCard = card;
            break;
        }

        room.deck.unshift(card);
    }

    if (!startingCard) {
        startingCard = room.deck.pop();
    }

    room.discard.push(startingCard);

    room.currentColor =
        startingCard.color;

    room.started = true;
}

/* =========================================================
   CARD LABELS
========================================================= */

function cardText(card) {

    switch (card.type) {

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

    if (card.type === "wild" ||
        card.type === "wild4") {
        return "wild";
    }

    return card.color;
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

${refresh
    ? `<meta http-equiv="refresh" content="3">`
    : ""}

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

/* =========================================================
   HOME
========================================================= */

app.get("/", (req, res) => {

    const html = page(
        "Pulse UNO",
        `
        <section class="center-page">

            <div class="panel home-panel">

                <div class="uno-logo">
                    UNO
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
                    OR
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
                    Pulse Suite
                </div>

            </div>

        </section>
        `
    );

    res.send(html);
});

/* =========================================================
   CREATE
========================================================= */

app.post("/create", (req, res) => {

    const name =
        String(req.body.name || "")
            .trim()
            .slice(0, 20);

    if (!name) {
        return res.redirect("/");
    }

    const result =
        createRoom(name);

    redirect(
        res,
        result.room.code,
        result.playerId
    );
});

/* =========================================================
   JOIN
========================================================= */

app.post("/join", (req, res) => {

    const name =
        String(req.body.name || "")
            .trim()
            .slice(0, 20);

    const code =
        String(req.body.room || "")
            .trim()
            .toUpperCase();

    const room =
        getRoom(code);

    if (!room) {
        return res.status(404).send(
            page(
                "Room Not Found",
                `
                <section class="center-page">
                    <div class="panel message-panel">
                        <h1>Room Not Found</h1>
                        <p>
                            That room doesn't exist.
                        </p>
                        <a class="button primary"
                           href="/">
                            Go Back
                        </a>
                    </div>
                </section>
                `
            )
        );
    }

    if (room.started) {
        return res.status(400).send(
            page(
                "Game Started",
                `
                <section class="center-page">
                    <div class="panel message-panel">
                        <h1>Game Already Started</h1>
                        <p>
                            You can't join this room anymore.
                        </p>
                        <a class="button primary"
                           href="/">
                            Go Back
                        </a>
                    </div>
                </section>
                `
            )
        );
    }

    if (room.players.length >= 4) {
        return res.status(400).send(
            page(
                "Room Full",
                `
                <section class="center-page">
                    <div class="panel message-panel">
                        <h1>Room Full</h1>
                        <p>
                            This room already has four players.
                        </p>
                        <a class="button primary"
                           href="/">
                            Go Back
                        </a>
                    </div>
                </section>
                `
            )
        );
    }

    const playerId =
        makeId();

    room.players.push({
        id: playerId,
        name: name || "Player",
        hand: [],
        connected: true,
        saidUno: false
    });

    redirect(
        res,
        room.code,
        playerId
    );
});

/* =========================================================
   GAME PAGE
========================================================= */

app.get("/game", (req, res) => {

    const code =
        String(req.query.room || "")
            .toUpperCase();

    const playerId =
        String(req.query.player || "");

    const room =
        getRoom(code);

    if (!room) {
        return res.redirect("/");
    }

    const player =
        getPlayer(room, playerId);

    if (!player) {
        return res.redirect("/");
    }

    player.connected = true;

    if (!room.started) {
        return renderLobby(
            req,
            res,
            room,
            player
        );
    }

    return renderGame(
        req,
        res,
        room,
        player
    );
});

/* =========================================================
   LOBBY
========================================================= */

function renderLobby(
    req,
    res,
    room,
    player
) {

    const isHost =
        room.hostId === player.id;

    const players =
        room.players
            .map((p, index) => `
                <div class="player-row">

                    <div class="player-number">
                        ${index + 1}
                    </div>

                    <div class="player-info">
                        <strong>
                            ${escapeHtml(p.name)}
                        </strong>

                        ${
                            p.id === room.hostId
                                ? `<span class="host">
                                    HOST
                                   </span>`
                                : ""
                        }
                    </div>

                </div>
            `)
            .join("");

    const startButton =
        isHost && room.players.length >= 2
            ? `
                <form action="/start" method="POST">

                    <input
                        type="hidden"
                        name="room"
                        value="${escapeHtml(room.code)}"
                    >

                    <input
                        type="hidden"
                        name="player"
                        value="${escapeHtml(player.id)}"
                    >

                    <button class="button primary">
                        START GAME
                    </button>

                </form>
              `
            : `
                <div class="waiting">
                    ${
                        room.players.length < 2
                            ? "Waiting for another player..."
                            : "Waiting for the host..."
                    }
                </div>
              `;

    res.send(
        page(
            "Pulse UNO — Lobby",
            `
            <section class="center-page">

                <div class="panel lobby-panel">

                    <div class="eyebrow">
                        PULSE UNO
                    </div>

                    <h1>Waiting Room</h1>

                    <div class="room-code">
                        ${escapeHtml(room.code)}
                    </div>

                    <p class="hint">
                        Give this room code to your friend.
                    </p>

                    <div class="section-title">
                        PLAYERS
                    </div>

                    <div class="player-list">
                        ${players}
                    </div>

                    ${startButton}

                </div>

            </section>
            `,
            true
        )
    );
}

/* =========================================================
   START
========================================================= */

app.post("/start", (req, res) => {

    const room =
        getRoom(req.body.room);

    const player =
        room &&
        getPlayer(
            room,
            req.body.player
        );

    if (!room || !player) {
        return res.redirect("/");
    }

    if (room.hostId !== player.id) {
        return redirect(
            res,
            room.code,
            player.id
        );
    }

    if (room.players.length < 2) {
        return redirect(
            res,
            room.code,
            player.id
        );
    }

    startGame(room);

    redirect(
        res,
        room.code,
        player.id
    );
});

/* =========================================================
   PLAY CARD
========================================================= */

app.post("/play", (req, res) => {

    const room =
        getRoom(req.body.room);

    const player =
        room &&
        getPlayer(
            room,
            req.body.player
        );

    if (!room || !player || !room.started) {
        return res.redirect("/");
    }

    const current =
        currentPlayer(room);

    if (!current || current.id !== player.id) {
        return redirect(
            res,
            room.code,
            player.id
        );
    }

    const index =
        Number.parseInt(
            req.body.card,
            10
        );

    if (
        Number.isNaN(index) ||
        index < 0 ||
        index >= player.hand.length
    ) {
        return redirect(
            res,
            room.code,
            player.id
        );
    }

    const card =
        player.hand[index];

    if (!isPlayable(room, card)) {
        return redirect(
            res,
            room.code,
            player.id
        );
    }

    // Wild +4 requires choosing a color
    if (card.type === "wild4" ||
        card.type === "wild") {

        const chosenColor =
            String(
                req.body.color || ""
            ).toLowerCase();

        if (!COLORS.includes(chosenColor)) {

            return renderWildChoice(
                req,
                res,
                room,
                player,
                index
            );
        }

        room.currentColor =
            chosenColor;
    } else {
        room.currentColor =
            card.color;
    }

    player.hand.splice(index, 1);

    room.discard.push(card);

    player.saidUno = false;

    // Winner
    if (player.hand.length === 0) {

        room.winner =
            player.id;

        return redirect(
            res,
            room.code,
            player.id
        );
    }

    // Draw stacking
    if (card.type === "draw2") {
        room.drawStack += 2;
    }

    if (card.type === "wild4") {
        room.drawStack += 4;
    }

    // Skip
    if (card.type === "skip") {
        nextTurn(room, 2);
    }

    // Reverse
    else if (card.type === "reverse") {

        room.players.reverse();

        room.turnIndex =
            room.players.findIndex(
                p => p.id === player.id
            );

        nextTurn(room, 1);
    }

    // Draw cards
    else if (
        card.type === "draw2" ||
        card.type === "wild4"
    ) {
        nextTurn(room, 1);
    }

    // Normal
    else {
        nextTurn(room, 1);
    }

    redirect(
        res,
        room.code,
        player.id
    );
});

/* =========================================================
   WILD CHOICE
========================================================= */

function renderWildChoice(
    req,
    res,
    room,
    player,
    cardIndex
) {

    res.send(
        page(
            "Choose a Color",
            `
            <section class="center-page">

                <div class="panel wild-panel">

                    <div class="uno-logo">
                        UNO
                    </div>

                    <h1>Choose a Color</h1>

                    <p class="subtitle">
                        What color should play continue with?
                    </p>

                    <div class="wild-grid">

                        ${COLORS.map(color => `
                            <form action="/play"
                                  method="POST">

                                <input
                                    type="hidden"
                                    name="room"
                                    value="${escapeHtml(room.code)}"
                                >

                                <input
                                    type="hidden"
                                    name="player"
                                    value="${escapeHtml(player.id)}"
                                >

                                <input
                                    type="hidden"
                                    name="card"
                                    value="${cardIndex}"
                                >

                                <input
                                    type="hidden"
                                    name="color"
                                    value="${color}"
                                >

                                <button
                                    class="wild-choice ${color}">
                                    ${color.toUpperCase()}
                                </button>

                            </form>
                        `).join("")}

                    </div>

                </div>

            </section>
            `
        )
    );
}

/* =========================================================
   DRAW
========================================================= */

app.post("/draw", (req, res) => {

    const room =
        getRoom(req.body.room);

    const player =
        room &&
        getPlayer(
            room,
            req.body.player
        );

    if (!room || !player || !room.started) {
        return res.redirect("/");
    }

    const current =
        currentPlayer(room);

    if (!current || current.id !== player.id) {
        return redirect(
            res,
            room.code,
            player.id
        );
    }

    let amount = 1;

    if (room.drawStack > 0) {
        amount = room.drawStack;
        room.drawStack = 0;
    }

    drawCards(
        room,
        player,
        amount
    );

    nextTurn(room, 1);

    redirect(
        res,
        room.code,
        player.id
    );
});

/* =========================================================
   UNO
========================================================= */

app.post("/uno", (req, res) => {

    const room =
        getRoom(req.body.room);

    const player =
        room &&
        getPlayer(
            room,
            req.body.player
        );

    if (!room || !player) {
        return res.redirect("/");
    }

    if (player.hand.length === 1) {
        player.saidUno = true;
    }

    redirect(
        res,
        room.code,
        player.id
    );
});

/* =========================================================
   NEW GAME
========================================================= */

app.post("/new-game", (req, res) => {

    const room =
        getRoom(req.body.room);

    const player =
        room &&
        getPlayer(
            room,
            req.body.player
        );

    if (!room || !player) {
        return res.redirect("/");
    }

    if (room.hostId !== player.id) {
        return redirect(
            res,
            room.code,
            player.id
        );
    }

    startGame(room);

    redirect(
        res,
        room.code,
        player.id
    );
});

/* =========================================================
   GAME RENDER
========================================================= */

function renderGame(
    req,
    res,
    room,
    player
) {

    const winner =
        room.winner
            ? getPlayer(
                room,
                room.winner
            )
            : null;

    if (winner) {

        const newGame =
            room.hostId === player.id
                ? `
                    <form action="/new-game"
                          method="POST">

                        <input
                            type="hidden"
                            name="room"
                            value="${escapeHtml(room.code)}"
                        >

                        <input
                            type="hidden"
                            name="player"
                            value="${escapeHtml(player.id)}"
                        >

                        <button class="button primary">
                            PLAY AGAIN
                        </button>

                    </form>
                  `
                : `
                    <div class="waiting">
                        Waiting for the host...
                    </div>
                  `;

        return res.send(
            page(
                "Game Over — Pulse UNO",
                `
                <section class="center-page">

                    <div class="panel winner-panel">

                        <div class="uno-logo">
                            UNO
                        </div>

                        <div class="eyebrow">
                            GAME OVER
                        </div>

                        <h1>
                            ${escapeHtml(winner.name)}
                            wins!
                        </h1>

                        ${newGame}

                    </div>

                </section>
                `,
                true
            )
        );
    }

    const current =
        currentPlayer(room);

    const myTurn =
        current &&
        current.id === player.id;

    const topCard =
        room.discard[
            room.discard.length - 1
        ];

    const opponentHtml =
        room.players
            .filter(p => p.id !== player.id)
            .map(p => `
                <div class="opponent">

                    <strong>
                        ${escapeHtml(p.name)}
                    </strong>

                    <span>
                        ${p.hand.length} cards
                    </span>

                    ${
                        current &&
                        current.id === p.id
                            ? `<b>TURN</b>`
                            : ""
                    }

                </div>
            `)
            .join("");

    const handHtml =
        player.hand
            .map((card, index) => {

                const playable =
                    myTurn &&
                    isPlayable(
                        room,
                        card
                    );

                return `
                    <div class="hand-card-wrap">

                        ${
                            playable
                                ? `
                                <form
                                    action="/play"
                                    method="POST">

                                    <input
                                        type="hidden"
                                        name="room"
                                        value="${escapeHtml(room.code)}"
                                    >

                                    <input
                                        type="hidden"
                                        name="player"
                                        value="${escapeHtml(player.id)}"
                                    >

                                    <input
                                        type="hidden"
                                        name="card"
                                        value="${index}"
                                    >

                                    <button
                                        class="uno-card ${cardClass(card)} playable"
                                        title="Play this card">

                                        <span>
                                            ${escapeHtml(
                                                cardText(card)
                                            )}
                                        </span>

                                    </button>

                                </form>
                                `
                                : `
                                <div
                                    class="uno-card ${cardClass(card)} disabled">

                                    <span>
                                        ${escapeHtml(
                                            cardText(card)
                                        )}
                                    </span>

                                </div>
                                `
                        }

                    </div>
                `;
            })
            .join("");

    const drawButton =
        myTurn
            ? `
                <form action="/draw"
                      method="POST">

                    <input
                        type="hidden"
                        name="room"
                        value="${escapeHtml(room.code)}"
                    >

                    <input
                        type="hidden"
                        name="player"
                        value="${escapeHtml(player.id)}"
                    >

                    <button class="button secondary">
                        ${
                            room.drawStack > 0
                                ? `DRAW +${room.drawStack}`
                                : "DRAW"
                        }
                    </button>

                </form>
              `
            : "";

    const unoButton =
        player.hand.length === 1
            ? `
                <form action="/uno"
                      method="POST">

                    <input
                        type="hidden"
                        name="room"
                        value="${escapeHtml(room.code)}"
                    >

                    <input
                        type="hidden"
                        name="player"
                        value="${escapeHtml(player.id)}"
                    >

                    <button class="button danger">
                        UNO!
                    </button>

                </form>
              `
            : "";

    res.send(
        page(
            "Pulse UNO",
            `
            <section class="game-page">

                <div class="game-header">

                    <div>
                        <div class="eyebrow">
                            PULSE UNO
                        </div>

                        <div class="room-small">
                            ROOM ${escapeHtml(room.code)}
                        </div>
                    </div>

                    <div class="turn-status">
                        ${
                            myTurn
                                ? "YOUR TURN"
                                : `${escapeHtml(current.name)}'S TURN`
                        }
                    </div>

                </div>

                <div class="opponents">
                    ${opponentHtml}
                </div>

                <div class="game-table">

                    <div class="pile-area">

                        <div class="pile-label">
                            DISCARD
                        </div>

                        <div class="uno-card large ${cardClass(topCard)}">

                            <span>
                                ${escapeHtml(
                                    cardText(topCard)
                                )}
                            </span>

                        </div>

                    </div>

                    <div class="color-display">

                        <div class="pile-label">
                            COLOR
                        </div>

                        <div class="color-name ${room.currentColor}">
                            ${escapeHtml(
                                room.currentColor || "—"
                            )}
                        </div>

                    </div>

                </div>

                <div class="game-controls">

                    ${drawButton}
                    ${unoButton}

                </div>

                <div class="hand-panel">

                    <div class="hand-header">

                        <span>
                            YOUR HAND
                        </span>

                        <span>
                            ${player.hand.length} cards
                        </span>

                    </div>

                    <div class="player-hand">
                        ${handHtml}
                    </div>

                </div>

            </section>
            `,
            true
        )
    );
}

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (req, res) => {

    res.json({
        ok: true,
        service: "Pulse UNO",
        status: "online",
        rooms: rooms.size
    });
});

/* =========================================================
   SERVER
========================================================= */

app.listen(PORT, () => {

    console.log(
        `Pulse UNO running on port ${PORT}`
    );

});
