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
      playerNames: [{ id: socket.id, name: `Player ${playerNumber}` }],
      gameState: null,
      penaltyCards: new Map(),
      round: 1,
      playerCounter: playerNumber,
      missedRedraws: new Map()
    });
    socket.join(roomId);
    socket.emit('gameCreated', roomId);
    console.log(`Room created: ${roomId}`);
  });

  socket.on('joinGame', (roomId) => {
    if (!rooms.has(roomId)) {
      socket.emit('error', 'Room does not exist');
      return;
    }
    const room = rooms.get(roomId);
    if (room.players.length >= 6) {
      socket.emit('error', 'Room is full (max 6 players)');
      return;
    }
    room.playerCounter++;
    const playerNumber = room.playerCounter;
    room.players.push(socket.id);
    room.playerNames.push({ id: socket.id, name: `Player ${playerNumber}` });
    socket.join(roomId);
    socket.emit('joined', roomId);
    io.to(roomId).emit('playerJoined', { count: room.players.length, players: room.playerNames });
    console.log(`Room ${roomId} now has ${room.players.length} players`);
  });

  socket.on('startGame', (roomId) => {
    const room = rooms.get(roomId);
    if (!room || room.players.length < 2) {
      socket.emit('error', 'Need at least 2 players');
      return;
    }
    startNewRound(roomId);
  });

  function applyPenalties(roomId) {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    
    const state = room.gameState;
    const missedPlayers = room.missedRedraws || new Map();
    
    for (let [playerId, missed] of missedPlayers) {
      if (missed > 0) {
        const player = state.players.find(p => p.id === playerId);
        if (player) {
          state.log.push(`⚠️ ${player.name} не переклав ${missed} можливу карту! Штраф...`);
          
          // Всі інші гравці скидають по 1 карті
          for (let other of state.players) {
            if (other.id !== playerId && other.hand.length > 0) {
              const penaltyCard = other.hand.pop();
              player.hand.push(penaltyCard);
              state.log.push(`  ${other.name} скинув ${penaltyCard.value}${penaltyCard.suit} ${player.name}`);
            }
          }
        }
      }
    }
    
    room.missedRedraws = new Map();
    io.to(roomId).emit('updateState', state);
  }

  function startNewRound(roomId) {
    const room = rooms.get(roomId);
    let gameDeck = shuffle([...fullDeck]);
    
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
    
    let trump = gameDeck.pop();
    if (trump.suit === '♠') {
      trump = gameDeck.pop();
    }
    
    room.gameState = {
      deck: gameDeck,
      trump: trump,
      players: playersData,
      currentDrawPlayer: 0,
      phase: 'redraw',  // Нова фаза: перекладання перед ходом
      log: [`🎴 Round ${room.round} started! Trump: ${trump.value}${trump.suit}`, `🔄 Тепер час перекласти карти (якщо можете)`],
      lastDrawnCard: null,
      waitingForPlace: false,
      redrawPhaseActive: true
    };
    
    for (let p of room.gameState.players) {
      io.to(p.id).emit('gameStarted', {
        hiddenCards: p.hidden,
        openCard: p.openCard,
        trump: room.gameState.trump,
        playersCount: room.players.length,
        yourName: p.name,
        penaltyCount: p.penaltyCount
      });
    }
    
    io.to(roomId).emit('updateState', room.gameState);
    startRedrawPhase(roomId);
  }

  function startRedrawPhase(roomId) {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    
    room.gameState.phase = 'redraw';
    room.gameState.redrawPhaseActive = true;
    room.missedRedraws = new Map();
    
    io.to(roomId).emit('redrawPhaseStart', { message: 'Можете перекладати свої карти іншим гравцям' });
    announceRedrawTurn(roomId);
  }

  function announceRedrawTurn(roomId) {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    
    if (!state.redrawPhaseActive) {
      // Фаза перекладання завершена
      state.phase = 'drawing';
      io.to(roomId).emit('updateState', state);
      announceTurn(roomId);
      return;
    }
    
    // Знаходимо наступного гравця, який ще не переклав
    let currentPlayer = null;
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      if (!p.hasRedrawn && p.isActive) {
        currentPlayer = p;
        state.currentDrawPlayer = i;
        break;
      }
    }
    
    if (!currentPlayer) {
      // Всі переклали — завершуємо фазу
      state.redrawPhaseActive = false;
      applyPenalties(roomId);
      state.phase = 'drawing';
      io.to(roomId).emit('updateState', state);
      announceTurn(roomId);
      return;
    }
    
    io.to(roomId).emit('redrawTurn', { 
      playerId: currentPlayer.id, 
      playerName: currentPlayer.name,
      openCard: currentPlayer.openCard
    });
  }

  socket.on('redrawCard', (roomId, targetPlayerId) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState || !room.gameState.redrawPhaseActive) return;
    
    const state = room.gameState;
    const player = state.players.find(p => p.id === socket.id);
    const targetPlayer = state.players.find(p => p.id === targetPlayerId);
    
    if (!player || !targetPlayer) {
      socket.emit('error', 'Гравець не знайдений');
      return;
    }
    
    if (player.hasRedrawn) {
      socket.emit('error', 'Ви вже переклали карту в цьому раунді');
      return;
    }
    
    if (player.openCard === null) {
      socket.emit('error', 'У вас немає відкритої карти для перекладання');
      return;
    }
    
    // Перевіряємо, чи можна перекласти (карта на 1 нижче)
    if (!isOneLower(player.openCard, targetPlayer.openCard)) {
      socket.emit('error', 'Цю карту не можна перекласти (потрібно на 1 нижче)');
      return;
    }
    
    // Перекладаємо карту
    const transferredCard = player.openCard;
    player.openCard = null;
    targetPlayer.openCard = transferredCard;
    player.hasRedrawn = true;
    
    state.log.push(`${player.name} переклав ${transferredCard.value}${transferredCard.suit} на ${targetPlayer.name}`);
    
    // Перевіряємо, чи залишилась у гравця відкрита карта
    if (player.openCard === null && player.hidden.length > 0) {
      player.openCard = player.hidden.pop();
      state.log.push(`${player.name} відкрив нову карту: ${player.openCard.value}${player.openCard.suit}`);
    }
    
    io.to(roomId).emit('updateState', state);
    
    // Переходимо до наступного гравця
    announceRedrawTurn(roomId);
  });

  socket.on('skipRedraw', (roomId) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState || !room.gameState.redrawPhaseActive) return;
    
    const state = room.gameState;
    const player = state.players.find(p => p.id === socket.id);
    
    if (!player || player.hasRedrawn) return;
    
    // Перевіряємо, чи МІГ гравець перекласти карту
    let couldRedraw = false;
    for (let other of state.players) {
      if (other.id !== player.id && other.openCard && isOneLower(player.openCard, other.openCard)) {
        couldRedraw = true;
        break;
      }
    }
    
    if (couldRedraw) {
      // Запам'ятовуємо, що гравець пропустив можливість
      const missed = room.missedRedraws.get(player.id) || 0;
      room.missedRedraws.set(player.id, missed + 1);
      state.log.push(`${player.name} вирішив не перекладати карту (була можливість)`);
    }
    
    player.hasRedrawn = true;
    announceRedrawTurn(roomId);
  });

  function announceTurn(roomId) {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    
    const activePlayers = state.players.filter(p => p.isActive);
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      io.to(roomId).emit('gameEnd', { winner: winner.name, message: `🏆 ${winner.name} wins!` });
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
    
    let attempts = 0;
    while (state.players[state.currentDrawPlayer] && !state.players[state.currentDrawPlayer].isActive && attempts < state.players.length) {
      state.currentDrawPlayer = (state.currentDrawPlayer + 1) % state.players.length;
      attempts++;
    }
    
    const currentPlayer = state.players[state.currentDrawPlayer];
    io.to(roomId).emit('nextTurn', { 
      playerId: currentPlayer.id, 
      playerName: currentPlayer.name,
      phase: state.phase 
    });
  }

  socket.on('drawCard', (roomId) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const player = state.players.find(p => p.id === socket.id);
    
    if (!player || state.players[state.currentDrawPlayer].id !== socket.id) {
      socket.emit('error', 'Not your turn to draw');
      return;
    }
    
    if (state.phase !== 'drawing') {
      socket.emit('error', 'Not drawing phase');
      return;
    }
    
    if (state.deck.length === 0) {
      socket.emit('error', 'Deck is empty!');
      return;
    }
    
    const drawnCard = state.deck.pop();
    state.lastDrawnCard = drawnCard;
    state.waitingForPlace = true;
    io.to(roomId).emit('cardDrawn', { card: drawnCard, playerId: socket.id });
    socket.emit('needDecision', { card: drawnCard });
  });

  socket.on('placeCard', (roomId, targetPlayerId) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const player = state.players.find(p => p.id === socket.id);
    
    if (!player || !state.waitingForPlace) {
      socket.emit('error', 'Cannot place card now');
      return;
    }
    
    const targetPlayer = state.players.find(p => p.id === targetPlayerId);
    if (!targetPlayer || !targetPlayer.openCard) {
      socket.emit('error', 'Cannot place on this card');
      return;
    }
    
    if (isOneLower(state.lastDrawnCard, targetPlayer.openCard)) {
      targetPlayer.openCard = state.lastDrawnCard;
      state.log.push(`${player.name} placed ${state.lastDrawnCard.value}${state.lastDrawnCard.suit} on ${targetPlayer.name}'s card`);
      state.waitingForPlace = false;
      state.lastDrawnCard = null;
      
      io.to(roomId).emit('updateState', state);
      
      state.currentDrawPlayer = (state.currentDrawPlayer + 1) % state.players.length;
      announceTurn(roomId);
    } else {
      socket.emit('error', 'Cannot place this card (need 1 lower)');
    }
  });

  socket.on('takeToHand', (roomId) => {
    const room = rooms.get(roomId);
    if (!room || !room.gameState) return;
    const state = room.gameState;
    const player = state.players.find(p => p.id === socket.id);
    
    if (!player || !state.waitingForPlace) {
      socket.emit('error', 'Cannot take card now');
      return;
    }
    
    player.hand.push(state.lastDrawnCard);
    state.log.push(`${player.name} took ${state.lastDrawnCard.value}${state.lastDrawnCard.suit}`);
    state.waitingForPlace = false;
    state.lastDrawnCard = null;
    io.to(roomId).emit('updateState', state);
    
    state.currentDrawPlayer = (state.currentDrawPlayer + 1) % state.players.length;
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
