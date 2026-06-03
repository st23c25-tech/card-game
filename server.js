const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(__dirname));

const suits = ['♥', '♦', '♣', '♠'];
const values = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
let fullDeck = [];

for (let s of suits) {
  for (let v of values) {
    fullDeck.push({ suit: s, value: v });
  }
}

function shuffle(d) {
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function getValueRank(value) {
  const order = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  return order.indexOf(value);
}

function isOneLower(card1, card2) {
  if (!card1 || !card2) return false;
  const rank1 = getValueRank(card1.value);
  const rank2 = getValueRank(card2.value);
  if (card1.value === '6' && card2.value === 'A') return true;
  return rank1 === rank2 - 1;
}

const rooms = new Map();
let globalPlayerCounter = 0;

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('createGame', () => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    globalPlayerCounter++;
    const playerNumber = globalPlayerCounter;
    rooms.set(roomId, {
      players: [socket.id],
      playerNames: [{ id: socket.id, name: `Гравець ${playerNumber}` }],
      gameState: null,
      penaltyCards: new Map(),
      round: 1,
      playerCounter: playerNumber,
      trumpCard: null
    });
    socket.join(roomId);
    socket.emit('gameCreated', roomId);
    console.log(`Room created: ${roomId}`);
  });

  socket.on('joinGame', (roomId) => {
    if (!rooms.has(roomId)) {
      socket.emit('error', 'Кімнати не існує');
      return;
    }
    const room = rooms.get(roomId);
    if (room.players.length >= 6) {
      socket.emit('error', 'Кімната повна (макс 6)');
      return;
    }
    room.playerCounter++;
    const playerNumber = room.playerCounter;
    room.players.push(socket.id);
    room.playerNames.push({ id: socket.id, name: `Гравець ${playerNumber}` });
    socket.join(roomId);
    socket.emit('joined', roomId);
    io.to(roomId).emit('playerJoined', { count: room.players.length, players: room.playerNames });
  });

  socket.on('startGame', (roomId) => {
    const room = rooms.get(roomId);
    if (!room || room.players.length < 2) {
      socket.emit('error', 'Потрібно мінімум 2 гравці');
      return;
    }
    startNewRound(roomId);
  });

  function startNewRound(roomId) {
    const room = rooms.get(roomId);
    let gameDeck = shuffle([...fullDeck]);
    
    let trumpCard = gameDeck.pop();
    if (trumpCard.suit === '♠') {
      trumpCard = gameDeck.pop();
    }
    room.trumpCard = trumpCard;
    
    const playersData = [];
    for (let i = 0; i < room.players.length; i++) {
      const penaltyCount = room.penaltyCards.get(room.players[i]) || 2;
      const hidden = [];
      for (let j = 0; j < penaltyCount; j++) {
        if (gameDeck.length > 0) hidden.push(gameDeck.pop());
      }
      const openCard = gameDeck.pop();
      playersData.push({
        id: room.players[i],
        name: room.playerNames.find(p => p.id === room.players[i]).name,
        hidden: hidden,
        openCard: openCard,
        hand: [],
        isActive: true,
        penaltyCount: penaltyCount
      });
    }
    
    room.gameState = {
      deck: gameDeck,
      trumpCard: room.trumpCard,
      trumpSuit: room.trumpCard.suit,
      players: playersData,
      currentDrawPlayer: 0,
      phase: 'drawing',
      log: [`🎴 Раунд ${room.round} почався!`],
      currentPlayerDrawing: true,
      lastDrawnCard: null
    };
    
    for (let p of room.gameState.players) {
      io.to(p.id).emit('gameStarted', {
        hiddenCards: p.hidden,
        openCard: p.openCard,
        playersCount: room.players.length,
        yourName: p.name,
        penaltyCount: p.penaltyCount
      });
    }
    
    io.to(roomId).emit('updateState', room.gameState);
    announceTurn(roomId);
  }

  function announceTurn(roomId) {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    
    const activePlayers = state.players.filter(p => p.isActive);
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      io.to(roomId).emit('gameEnd', { winner: winner.name, message: `🏆 ${winner.name} переміг!` });
      room.penaltyCards.set(winner.id, 2);
      for (let p of state.players) {
        if (p.id !== winner.id) {
          const current = room.penaltyCards.get(p.id) || 2;
          room.penaltyCards.set(p.id, current + 1);
        }
      }
      room.round++;
      startNewRound(roomId);
      return;
    }
    
    while (state.players[state.currentDrawPlayer] && !state.players[state.currentDrawPlayer].isActive) {
      state.currentDrawPlayer = (state.currentDrawPlayer + 1) % state.players.length;
    }
    
    const currentPlayer = state.players[state.currentDrawPlayer];
    state.currentPlayerDrawing = true;
    io.to(roomId).emit('nextTurn', { 
      playerId: currentPlayer.id, 
      playerName: currentPlayer.name 
    });
  }

  function canPlaceAnywhere(state, card, playerId) {
    for (let p of state.players) {
      if (p.id !== playerId && p.openCard && isOneLower(card, p.openCard)) {
        return true;
      }
    }
    return false;
  }

  socket.on('drawCard', (roomId) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const player = state.players.find(p => p.id === socket.id);
    
    if (!player || state.players[state.currentDrawPlayer].id !== socket.id) {
      socket.emit('error', '❌ Зараз не твоя черга');
      return;
    }
    
    if (!state.currentPlayerDrawing) {
      socket.emit('error', '❌ Ти вже маєш карту, обери дію');
      return;
    }
    
    if (state.deck.length === 0) {
      socket.emit('error', 'Колода порожня!');
      return;
    }
    
    const drawnCard = state.deck.pop();
    state.lastDrawnCard = drawnCard;
    state.currentPlayerDrawing = false;
    
    io.to(roomId).emit('cardDrawn', { card: drawnCard, playerId: socket.id });
    socket.emit('needDecision', { 
      card: drawnCard,
      canPlaceAnywhere: canPlaceAnywhere(state, drawnCard, socket.id),
      canPlaceOnSelf: (player.openCard && isOneLower(drawnCard, player.openCard))
    });
  });

  socket.on('placeOnOther', (roomId, targetPlayerId) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const player = state.players.find(p => p.id === socket.id);
    const targetPlayer = state.players.find(p => p.id === targetPlayerId);
    
    if (!player || !targetPlayer || !state.lastDrawnCard) {
      socket.emit('error', 'Помилка');
      return;
    }
    
    if (!targetPlayer.openCard || !isOneLower(state.lastDrawnCard, targetPlayer.openCard)) {
      socket.emit('error', 'Не можна покласти на цю карту');
      return;
    }
    
    targetPlayer.openCard = state.lastDrawnCard;
    state.log.push(`${player.name} поклав ${state.lastDrawnCard.value}${state.lastDrawnCard.suit} на ${targetPlayer.name}`);
    state.lastDrawnCard = null;
    state.currentPlayerDrawing = true;
    
    io.to(roomId).emit('updateState', state);
    
    // Продовжуємо хід - гравець тягне наступну карту
    io.to(socket.id).emit('continueTurn');
  });

  socket.on('placeOnSelf', (roomId) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const player = state.players.find(p => p.id === socket.id);
    
    if (!player || !state.lastDrawnCard) return;
    
    if (player.openCard && isOneLower(state.lastDrawnCard, player.openCard)) {
      player.openCard = state.lastDrawnCard;
      state.log.push(`${player.name} поклав ${state.lastDrawnCard.value}${state.lastDrawnCard.suit} на свою карту`);
      state.lastDrawnCard = null;
      state.currentPlayerDrawing = true;
      
      io.to(roomId).emit('updateState', state);
      io.to(socket.id).emit('continueTurn');
    } else {
      socket.emit('error', 'Не можна покласти на свою карту');
    }
  });

  socket.on('takeToHand', (roomId) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const player = state.players.find(p => p.id === socket.id);
    
    if (!player || !state.lastDrawnCard) return;
    
    player.hand.push(state.lastDrawnCard);
    state.log.push(`${player.name} забрав карту ${state.lastDrawnCard.value}${state.lastDrawnCard.suit} собі в руку`);
    state.lastDrawnCard = null;
    
    io.to(roomId).emit('updateState', state);
    
    // Хід закінчується
    state.currentDrawPlayer = (state.currentDrawPlayer + 1) % state.players.length;
    state.currentPlayerDrawing = true;
    announceTurn(roomId);
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    for (let [roomId, room] of rooms.entries()) {
      const index = room.players.indexOf(socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        room.playerNames.splice(index, 1);
        io.to(roomId).emit('playerJoined', { count: room.players.length, players: room.playerNames });
        if (room.gameState) {
          const playerIndex = room.gameState.players.findIndex(p => p.id === socket.id);
          if (playerIndex !== -1) {
            room.gameState.players[playerIndex].isActive = false;
          }
          io.to(roomId).emit('updateState', room.gameState);
          announceTurn(roomId);
        }
        if (room.players.length === 0) {
          rooms.delete(roomId);
        }
        break;
      }
    }
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`🎮 Server running on port ${port}`);
});
