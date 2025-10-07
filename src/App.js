import React, { useState, useEffect, useRef } from 'react';
import { Users, Eye, Crown, AlertCircle, Shuffle } from 'lucide-react';

// Load Tailwind CSS
if (typeof document !== 'undefined' && !document.getElementById('tailwind-styles')) {
  const script = document.createElement('script');
  script.id = 'tailwind-styles';
  script.src = 'https://cdn.tailwindcss.com';
  document.head.appendChild(script);
}

// Firebase will be loaded dynamically
let firebaseApp = null;
let firebaseDatabase = null;
let firebaseInitialized = false;

const CARD_VALUES = {
  'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 10, 'Q': 10, 'K♠': 10, 'K♣': 10, 'K♥': -1, 'K♦': -1, 'JOKER': 0
};

const SUITS = ['♠', '♥', '♦', '♣'];

function CambioGame() {
  const [gameState, setGameState] = useState('setup');
  const [configApiKey, setConfigApiKey] = useState('');
  const [configAuthDomain, setConfigAuthDomain] = useState('');
  const [configDatabaseURL, setConfigDatabaseURL] = useState('');
  const [configProjectId, setConfigProjectId] = useState('');
  const [configStorageBucket, setConfigStorageBucket] = useState('');
  const [configMessagingSenderId, setConfigMessagingSenderId] = useState('');
  const [configAppId, setConfigAppId] = useState('');
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [playerId] = useState('player_' + Math.random().toString(36).substr(2, 9));
  const [gameData, setGameData] = useState(null);
  const [myCards, setMyCards] = useState([]);
  const [viewedCards, setViewedCards] = useState([]);
  const [drawnCard, setDrawnCard] = useState(null);
  const [message, setMessage] = useState('');
  const [hasViewedInitial, setHasViewedInitial] = useState(false);
  const gameListenerRef = useRef(null);

  const initializeFirebase = async () => {
    if (firebaseInitialized) return true;

    try {
      const firebaseConfig = {
        apiKey: "AIzaSyB_-qYcTEiMOg5wT97QgOf76iEeK9FP6Jw",
        authDomain: "cambio-8ce14.firebaseapp.com",
        databaseURL: "https://cambio-8ce14-default-rtdb.firebaseio.com",
        projectId: "cambio-8c37e14",
        storageBucket: "cambio-8ce14.firebasestorage.app",
        messagingSenderId: "985451632057",
        appId: "1:985451632057:web:d3562acdaf29f2bb24d268",
        measurementId: "G-C9SZB4ZJ39"
      };

      const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
      const { getDatabase, ref, set, onValue, update, onDisconnect } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');

      firebaseApp = initializeApp(firebaseConfig);
      firebaseDatabase = { getDatabase, ref, set, onValue, update, onDisconnect };
      firebaseInitialized = true;
      setFirebaseReady(true);
      setMessage('Firebase connected!');
      return true;
    } catch (error) {
      console.error('Firebase initialization error:', error);
      setMessage('Firebase initialization failed: ' + error.message);
      return false;
    }
  };

  const createDeck = () => {
    const deck = [];
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q'];
    
    SUITS.forEach(suit => {
      ranks.forEach(rank => deck.push(rank + suit));
    });
    
    deck.push('K♥', 'K♦', 'K♠', 'K♣');
    deck.push('JOKER', 'JOKER');
    
    return deck.sort(() => Math.random() - 0.5);
  };

  const createGame = async () => {
    if (!playerName.trim()) {
      setMessage('Please enter your name!');
      return;
    }

    if (!firebaseReady) {
      const initialized = await initializeFirebase();
      if (!initialized) return;
    }

    const code = Math.random().toString(36).substr(2, 6).toUpperCase();
    const deck = createDeck();
    
    const { getDatabase, ref, set, onDisconnect } = firebaseDatabase;
    const db = getDatabase(firebaseApp);
    const gameRef = ref(db, `games/${code}`);

    await set(gameRef, {
      host: playerId,
      deck: deck,
      discardPile: [],
      currentPlayerIndex: 0,
      playerOrder: [playerId],
      players: {
        [playerId]: {
          name: playerName,
          cards: [],
          hasViewedInitial: false,
          connected: true
        }
      },
      started: false,
      phase: 'lobby',
      gameOver: false
    });

    onDisconnect(ref(db, `games/${code}/players/${playerId}/connected`)).set(false);

    setRoomCode(code);
    listenToGame(code);
    setGameState('lobby');
    setMessage(`Room created! Code: ${code}`);
  };

  const joinGame = async () => {
    if (!playerName.trim() || !roomCode.trim()) {
      setMessage('Please enter your name and room code!');
      return;
    }

    if (!firebaseReady) {
      const initialized = await initializeFirebase();
      if (!initialized) return;
    }

    const { getDatabase, ref, set, onValue, update, onDisconnect } = firebaseDatabase;
    const db = getDatabase(firebaseApp);
    const gameRef = ref(db, `games/${roomCode.toUpperCase()}`);

    const snapshot = await new Promise(resolve => onValue(gameRef, resolve, { onlyOnce: true }));
    
    if (!snapshot.val()) {
      setMessage('Room not found!');
      return;
    }

    const game = snapshot.val();
    if (game.started) {
      setMessage('Game already started!');
      return;
    }

    const newPlayerOrder = [...game.playerOrder, playerId];
    await update(ref(db, `games/${roomCode.toUpperCase()}`), {
      playerOrder: newPlayerOrder
    });

    await set(ref(db, `games/${roomCode.toUpperCase()}/players/${playerId}`), {
      name: playerName,
      cards: [],
      hasViewedInitial: false,
      connected: true
    });

    onDisconnect(ref(db, `games/${roomCode.toUpperCase()}/players/${playerId}/connected`)).set(false);

    listenToGame(roomCode.toUpperCase());
    setGameState('lobby');
    setMessage('Joined game!');
  };

  const listenToGame = (code) => {
    if (gameListenerRef.current) gameListenerRef.current();

    const { getDatabase, ref, onValue } = firebaseDatabase;
    const db = getDatabase(firebaseApp);
    const gameRef = ref(db, `games/${code}`);

    gameListenerRef.current = onValue(gameRef, (snapshot) => {
      const game = snapshot.val();
      if (!game) return;

      setGameData(game);

      if (game.players && game.players[playerId]) {
        setMyCards(game.players[playerId].cards || []);
        setHasViewedInitial(game.players[playerId].hasViewedInitial || false);
      }

      if (game.started && !game.gameOver && game.phase !== 'lobby') {
        setGameState('game');
      }

      if (game.gameOver) {
        setGameState('gameover');
      }

      if (game.drawnCard && game.drawnBy === playerId) {
        setDrawnCard(game.drawnCard);
      } else {
        setDrawnCard(null);
      }
    });
  };

  const startGame = async () => {
    if (!gameData || gameData.playerOrder.length < 2) {
      setMessage('Need at least 2 players!');
      return;
    }

    const { getDatabase, ref, update } = firebaseDatabase;
    const db = getDatabase(firebaseApp);

    let deck = [...gameData.deck];
    const updatedPlayers = {};

    gameData.playerOrder.forEach(pid => {
      updatedPlayers[pid] = {
        ...gameData.players[pid],
        cards: [
          { card: deck.pop(), visible: false },
          { card: deck.pop(), visible: false },
          { card: deck.pop(), visible: false },
          { card: deck.pop(), visible: false }
        ]
      };
    });

    await update(ref(db, `games/${roomCode}`), {
      deck: deck,
      players: updatedPlayers,
      started: true,
      phase: 'initial_view',
      currentPlayerIndex: 0
    });

    setMessage('Game started! View your 2 closest cards');
  };

  const viewInitialCards = async () => {
    if (hasViewedInitial) return;

    const { getDatabase, ref, update } = firebaseDatabase;
    const db = getDatabase(firebaseApp);

    const updatedCards = [...myCards];
    updatedCards[0].visible = true;
    updatedCards[1].visible = true;

    await update(ref(db, `games/${roomCode}/players/${playerId}`), {
      cards: updatedCards,
      hasViewedInitial: true
    });

    setViewedCards([0, 1]);

    setTimeout(async () => {
      updatedCards[0].visible = false;
      updatedCards[1].visible = false;
      await update(ref(db, `games/${roomCode}/players/${playerId}/cards`), updatedCards);
      setViewedCards([]);
      checkAllViewed();
    }, 3000);
  };

  const checkAllViewed = async () => {
    const { getDatabase, ref, update } = firebaseDatabase;
    const db = getDatabase(firebaseApp);

    const allViewed = gameData.playerOrder.every(pid => 
      gameData.players[pid].hasViewedInitial
    );

    if (allViewed) {
      await update(ref(db, `games/${roomCode}`), {
        phase: 'playing'
      });
    }
  };

  const drawCard = async () => {
    if (drawnCard || !isMyTurn()) return;

    const { getDatabase, ref, update } = firebaseDatabase;
    const db = getDatabase(firebaseApp);

    const deck = [...gameData.deck];
    if (deck.length === 0) {
      setMessage('Deck is empty!');
      return;
    }

    const card = deck.pop();

    await update(ref(db, `games/${roomCode}`), {
      deck: deck,
      drawnCard: card,
      drawnBy: playerId
    });

    setMessage(`Drew: ${card}. Choose to swap or discard.`);
  };

  const swapCard = async (cardIndex) => {
    if (!drawnCard) return;

    const { getDatabase, ref, update } = firebaseDatabase;
    const db = getDatabase(firebaseApp);

    const updatedCards = [...myCards];
    const oldCard = updatedCards[cardIndex].card;
    updatedCards[cardIndex] = { card: drawnCard, visible: false };

    const newDiscard = [...gameData.discardPile, oldCard];

    await update(ref(db, `games/${roomCode}`), {
      discardPile: newDiscard,
      drawnCard: null,
      drawnBy: null
    });

    await update(ref(db, `games/${roomCode}/players/${playerId}`), {
      cards: updatedCards
    });

    nextTurn();
  };

  const discardDrawn = async () => {
    if (!drawnCard) return;

    const { getDatabase, ref, update } = firebaseDatabase;
    const db = getDatabase(firebaseApp);

    const newDiscard = [...gameData.discardPile, drawnCard];

    await update(ref(db, `games/${roomCode}`), {
      discardPile: newDiscard,
      drawnCard: null,
      drawnBy: null
    });

    nextTurn();
  };

  const nextTurn = async () => {
    const { getDatabase, ref, update } = firebaseDatabase;
    const db = getDatabase(firebaseApp);

    const nextIndex = (gameData.currentPlayerIndex + 1) % gameData.playerOrder.length;

    if (gameData.finalRound && nextIndex === gameData.cambioCallerIndex) {
      await endGame();
      return;
    }

    await update(ref(db, `games/${roomCode}`), {
      currentPlayerIndex: nextIndex
    });
  };

  const callCambio = async () => {
    if (!isMyTurn() || drawnCard) return;

    const { getDatabase, ref, update } = firebaseDatabase;
    const db = getDatabase(firebaseApp);

    const myIndex = gameData.playerOrder.indexOf(playerId);

    await update(ref(db, `games/${roomCode}`), {
      finalRound: true,
      cambioCaller: playerId,
      cambioCallerIndex: myIndex
    });

    setMessage('CAMBIO called! Everyone gets one more turn!');
    nextTurn();
  };

  const endGame = async () => {
    const { getDatabase, ref, update } = firebaseDatabase;
    const db = getDatabase(firebaseApp);

    const revealedPlayers = {};
    gameData.playerOrder.forEach(pid => {
      revealedPlayers[pid] = {
        ...gameData.players[pid],
        cards: gameData.players[pid].cards.map(c => ({ ...c, visible: true }))
      };
    });

    const scores = gameData.playerOrder.map(pid => ({
      playerId: pid,
      name: gameData.players[pid].name,
      score: calculateScore(gameData.players[pid].cards)
    }));

    scores.sort((a, b) => a.score - b.score);

    await update(ref(db, `games/${roomCode}`), {
      players: revealedPlayers,
      gameOver: true,
      winner: scores[0].playerId,
      finalScores: scores
    });
  };

  const calculateScore = (cards) => {
    return cards.reduce((sum, c) => {
      const rank = c.card.replace(/[♠♥♦♣]/g, '');
      if (rank === 'K' && (c.card.includes('♥') || c.card.includes('♦'))) {
        return sum - 1;
      }
      return sum + (CARD_VALUES[rank] || CARD_VALUES[c.card] || 0);
    }, 0);
  };

  const isMyTurn = () => {
    if (!gameData || !gameData.playerOrder) return false;
    return gameData.playerOrder[gameData.currentPlayerIndex] === playerId;
  };

  const getCardColor = (card) => {
    if (card.includes('♥') || card.includes('♦')) return 'text-red-600';
    return 'text-gray-900';
  };

  const resetGame = () => {
    if (gameListenerRef.current) gameListenerRef.current();
    setGameState('setup');
    setRoomCode('');
    setGameData(null);
    setMyCards([]);
    setViewedCards([]);
    setDrawnCard(null);
    setHasViewedInitial(false);
    setMessage('');
  };

  if (gameState === 'setup') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-800 to-green-600 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-2xl w-full">
          <h1 className="text-4xl font-bold text-center text-green-800 mb-2">Cambio</h1>
          <p className="text-center text-gray-600 mb-6">Multiplayer Card Game</p>
          
          <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <h3 className="font-bold text-lg mb-2 text-blue-800">Firebase Setup Required</h3>
            <p className="text-sm text-gray-700 mb-3">
              To use multiplayer, you need to set up a Firebase project:
            </p>
            <ol className="text-sm text-gray-700 space-y-1 ml-4 list-decimal">
              <li>Go to <a href="https://console.firebase.google.com/" target="_blank" className="text-blue-600 underline">Firebase Console</a></li>
              <li>Create a new project</li>
              <li>Enable Realtime Database</li>
              <li>Get your config from Project Settings</li>
              <li>Enter your config below</li>
            </ol>
          </div>

          <div className="space-y-3 mb-6">
            <input
              type="text"
              placeholder="API Key"
              value={configApiKey}
              onChange={(e) => setConfigApiKey(e.target.value)}
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-green-500 text-sm"
            />
            <input
              type="text"
              placeholder="Auth Domain (yourproject.firebaseapp.com)"
              value={configAuthDomain}
              onChange={(e) => setConfigAuthDomain(e.target.value)}
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-green-500 text-sm"
            />
            <input
              type="text"
              placeholder="Database URL (https://yourproject.firebaseio.com)"
              value={configDatabaseURL}
              onChange={(e) => setConfigDatabaseURL(e.target.value)}
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-green-500 text-sm"
            />
            <input
              type="text"
              placeholder="Project ID"
              value={configProjectId}
              onChange={(e) => setConfigProjectId(e.target.value)}
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-green-500 text-sm"
            />
            <input
              type="text"
              placeholder="Storage Bucket (yourproject.appspot.com)"
              value={configStorageBucket}
              onChange={(e) => setConfigStorageBucket(e.target.value)}
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-green-500 text-sm"
            />
            <input
              type="text"
              placeholder="Messaging Sender ID"
              value={configMessagingSenderId}
              onChange={(e) => setConfigMessagingSenderId(e.target.value)}
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-green-500 text-sm"
            />
            <input
              type="text"
              placeholder="App ID"
              value={configAppId}
              onChange={(e) => setConfigAppId(e.target.value)}
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-green-500 text-sm"
            />
          </div>

          <button
            onClick={() => setGameState('menu')}
            className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition"
          >
            Continue to Game
          </button>

          {message && (
            <div className="mt-4 p-3 bg-blue-100 text-blue-800 rounded-lg text-sm text-center">
              {message}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (gameState === 'menu') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-800 to-green-600 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
          <h1 className="text-4xl font-bold text-center text-green-800 mb-2">Cambio</h1>
          <p className="text-center text-gray-600 mb-6">Multiplayer Card Game</p>
          
          <input
            type="text"
            placeholder="Enter your name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg mb-4 focus:outline-none focus:border-green-500"
          />

          <button
            onClick={createGame}
            className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition mb-3"
          >
            Create Game
          </button>

          <div className="flex items-center gap-2 mb-3">
            <input
              type="text"
              placeholder="Room Code"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              className="flex-1 px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-green-500"
            />
            <button
              onClick={joinGame}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
            >
              Join
            </button>
          </div>

          {message && (
            <div className="mt-4 p-3 bg-blue-100 text-blue-800 rounded-lg text-sm text-center">
              {message}
            </div>
          )}

          <div className="mt-6 p-4 bg-gray-100 rounded-lg text-xs text-gray-600">
            <p className="font-semibold mb-1">Quick Rules:</p>
            <p>• Lowest score wins</p>
            <p>• View 2 closest cards at start</p>
            <p>• Draw and swap to reduce points</p>
            <p>• Call "CAMBIO" to end game</p>
          </div>
        </div>
      </div>
    );
  }

  if (gameState === 'lobby') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-800 to-green-600 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
          <h2 className="text-3xl font-bold text-center text-green-800 mb-4">Game Lobby</h2>
          <div className="text-center mb-6">
            <p className="text-gray-600">Room Code:</p>
            <p className="text-3xl font-bold text-green-600">{roomCode}</p>
          </div>

          <div className="mb-6">
            <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
              <Users size={20} />
              Players ({gameData ? gameData.playerOrder.length : 0})
            </h3>
            <div className="space-y-2">
              {gameData && gameData.playerOrder.map(pid => {
                const player = gameData.players[pid];
                return (
                  <div key={pid} className="flex items-center justify-between p-3 bg-gray-100 rounded-lg">
                    <span className="font-medium">{player.name} {!player.connected && '(disconnected)'}</span>
                    {pid === gameData.host && <Crown className="text-yellow-500" size={20} />}
                  </div>
                );
              })}
            </div>
          </div>

          {gameData && gameData.host === playerId && (
            <button
              onClick={startGame}
              className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition"
            >
              Start Game
            </button>
          )}

          {message && (
            <div className="mt-4 p-3 bg-blue-100 text-blue-800 rounded-lg text-sm text-center">
              {message}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (gameState === 'game') {
    const myTurn = isMyTurn();

    return (
      <div className="min-h-screen bg-gradient-to-br from-green-800 to-green-600 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="bg-white rounded-xl shadow-lg p-4 mb-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold text-green-800">Cambio</h2>
                <p className="text-sm text-gray-600">Room: {roomCode}</p>
              </div>
              <div className="text-right">
                <p className={`font-bold ${myTurn ? 'text-green-600 text-lg' : 'text-gray-600'}`}>
                  {myTurn ? 'YOUR TURN' : `${gameData?.players[gameData?.playerOrder[gameData?.currentPlayerIndex]]?.name}'s Turn`}
                </p>
                <p className="text-sm text-gray-600">
                  Deck: {gameData?.deck?.length || 0} cards
                </p>
                {gameData?.finalRound && (
                  <p className="text-sm text-red-600 font-bold">FINAL ROUND!</p>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-white rounded-xl shadow-lg p-6">
              <h3 className="font-bold text-lg mb-4">Players</h3>
              <div className="space-y-4">
                {gameData && gameData.playerOrder.map((pid, idx) => {
                  const player = gameData.players[pid];
                  const isMe = pid === playerId;
                  const isCurrent = idx === gameData.currentPlayerIndex;

                  return (
                    <div key={pid} className={`p-4 rounded-lg border-2 ${
                      isMe ? 'border-green-500 bg-green-50' :
                      isCurrent ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                    }`}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-semibold">
                          {player.name} {isMe && '(You)'}
                          {pid === gameData.cambioCaller && ' 🎯'}
                        </span>
                        <span className="text-sm text-gray-600">{player.cards?.length || 0} cards</span>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {player.cards?.map((cardObj, cardIdx) => (
                          <div
                            key={cardIdx}
                            className={`w-16 h-24 bg-white border-2 rounded-lg flex items-center justify-center text-2xl font-bold cursor-pointer hover:shadow-lg transition ${
                              isMe && (cardObj.visible || viewedCards.includes(cardIdx)) ? 'border-blue-500' : 'border-gray-300'
                            }`}
                            onClick={() => {
                              if (isMe && drawnCard && myTurn) {
                                swapCard(cardIdx);
                              }
                            }}
                          >
                            {isMe && (cardObj.visible || viewedCards.includes(cardIdx)) ? (
                              <span className={getCardColor(cardObj.card)}>{cardObj.card}</span>
                            ) : (
                              <div className="text-green-700">🂠</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4">
              {drawnCard && (
                <div className="bg-white rounded-xl shadow-lg p-6">
                  <h3 className="font-bold text-lg mb-3">Drawn Card</h3>
                  <div className={`w-20 h-28 bg-white border-4 border-blue-500 rounded-lg flex items-center justify-center text-3xl font-bold mx-auto mb-4 ${getCardColor(drawnCard)}`}>
                    {drawnCard}
                  </div>
                  <button
                    onClick={discardDrawn}
                    className="w-full bg-red-600 text-white py-2 rounded-lg font-semibold hover:bg-red-700 transition mb-2"
                  >
                    Discard
                  </button>
                  <p className="text-xs text-center text-gray-600">Or click your card to swap</p>
                </div>
              )}

              <div className="bg-white rounded-xl shadow-lg p-6">
                <h3 className="font-bold text-lg mb-3">Actions</h3>
                
                {gameData?.phase === 'initial_view' && !hasViewedInitial && (
                  <button
                    onClick={viewInitialCards}
                    className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition mb-3 flex items-center justify-center gap-2"
                  >
                    <Eye size={20} />
                    View 2 Cards
                  </button>
                )}

                {myTurn && !drawnCard && gameData?.phase === 'playing' && (
                  <>
                    <button
                      onClick={drawCard}
                      className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition mb-3"
                    >
                      Draw Card
                    </button>

                    {!gameData.finalRound && (
                      <button
                        onClick={callCambio}
                        className="w-full bg-yellow-600 text-white py-3 rounded-lg font-semibold hover:bg-yellow-700 transition"
                      >
                        Call CAMBIO
                      </button>
                    )}
                  </>
                )}
              </div>

              <div className="bg-white rounded-xl shadow-lg p-6">
                <h3 className="font-bold text-lg mb-3">Discard Pile</h3>
                {gameData?.discardPile?.length > 0 ? (
                  <div className={`w-20 h-28 bg-white border-2 border-gray-300 rounded-lg flex items-center justify-center text-3xl font-bold mx-auto ${getCardColor(gameData.discardPile[gameData.discardPile.length - 1])}`}>
                    {gameData.discardPile[gameData.discardPile.length - 1]}
                  </div>
                ) : (
                  <div className="text-center text-gray-500 text-sm">Empty</div>
                )}
              </div>
            </div>
          </div>

          {message && (
            <div className="mt-4 bg-white rounded-xl shadow-lg p-4 text-center">
              <p className="font-semibold text-gray-800">{message}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (gameState === 'gameover') {
    const winner = gameData?.finalScores?.[0];
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-800 to-green-600 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-2xl w-full">
          <h1 className="text-4xl font-bold text-center text-green-800 mb-6">Game Over!</h1>
          
          <div className="mb-6 p-6 bg-yellow-100 rounded-lg border-2 border-yellow-400">
            <p className="text-center text-lg font-semibold mb-2">🏆 Winner: {winner?.name}</p>
            <p className="text-center text-3xl font-bold text-yellow-700">Score: {winner?.score}</p>
          </div>

          <div className="space-y-4 mb-6">
            <h3 className="font-bold text-lg">Final Scores:</h3>
            {gameData?.finalScores?.map((score, idx) => {
              const player = gameData.players[score.playerId];
              return (
                <div key={score.playerId} className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold">{score.name}</span>
                    <span className="text-lg font-bold">Score: {score.score}</span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {player.cards.map((cardObj, cardIdx) => (
                      <div
                        key={cardIdx}
                        className={`w-14 h-20 bg-white border-2 border-gray-300 rounded-lg flex items-center justify-center text-xl font-bold ${getCardColor(cardObj.card)}`}
                      >
                        {cardObj.card}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={resetGame}
            className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition"
          >
            Back to Menu
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export default CambioGame;