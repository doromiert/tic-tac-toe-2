import "./index.css";
import React, { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  addDoc,
} from "firebase/firestore";

// REPLACE THIS with your actual config from Firebase
const firebaseConfig = {
  apiKey: "AIzaSyD3ZQ5HQOKuGL7JAzEeeOM1YDcJWHeOlH0",
  authDomain: "tic-tac-toe-2-4c9e8.firebaseapp.com",
  projectId: "tic-tac-toe-2-4c9e8",
  storageBucket: "tic-tac-toe-2-4c9e8.firebasestorage.app",
  messagingSenderId: "398580270686",
  appId: "1:398580270686:web:1a2924b5db52523dae16cf",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// --- GAME CONFIGURATION ---
const DEFAULT_COLS = 9;
const DEFAULT_ROWS = 9;
const MAX_ITERATIONS = 200;
// --- UTILS ---
const generateId = () => Math.random().toString(36).substr(2, 9);
const downloadJSON = (data, filename) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
const createEmptyBoard = (c, r) =>
  Array(r)
    .fill(null)
    .map(() =>
      Array(c)
        .fill(null)
        .map(() => ({
          type: "empty",
          walls: { r: false, b: false, br: false, bl: false },
          dead: false,
          lineId: null,
          isTarget: false,
          mechanicalLock: false,
          flipMod: false,
        })),
    );

export default function App() {
  const [savedCampaigns, setSavedCampaigns] = useState([]);
  const rtcRef = useRef(null);
  const dcRef = useRef(null);
  const isHostRef = useRef(false); // Ref used inside event listeners
  const [isMultiplayer, setIsMultiplayer] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [pendingRemoteMove, setPendingRemoteMove] = useState(null);
  // --- NEW FIREBASE SIGNALING STATE ---
  const [lobbyCode, setLobbyCode] = useState("");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [connectionStatus, setConnectionStatus] = useState("disconnected"); // 'disconnected', 'connecting', 'connected'

  // --- HOST LOGIC ---
  const startMultiplayerHost = async () => {
    setIsHost(true);
    isHostRef.current = true;
    setIsMultiplayer(true);
    setConnectionStatus("connecting");

    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    setLobbyCode(code);

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });
    rtcRef.current = pc;

    const dc = pc.createDataChannel("t3-game");
    setupDataChannel(dc);

    const gameDoc = doc(db, "games", code);

    // 1. Wait for ALL ICE candidates to finish gathering
    pc.onicecandidate = async (e) => {
      // When e.candidate is null, WebRTC is signaling that it has found all network paths!
      if (!e.candidate) {
        console.log(
          "🟢 Host finished gathering ICE candidates. Writing Offer...",
        );
        await setDoc(gameDoc, {
          // The localDescription.sdp now automatically contains all the ICE candidates!
          offer: {
            type: pc.localDescription.type,
            sdp: pc.localDescription.sdp,
          },
        });
      }
    };

    // 2. Create and set the offer (This triggers onicecandidate to start searching)
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // 3. Listen for the Joiner's final Answer package
    onSnapshot(gameDoc, async (snapshot) => {
      const data = snapshot.data();
      if (!pc.currentRemoteDescription && data?.answer) {
        console.log("🟢 Host received Joiner's Answer! Connecting...");
        const answerDescription = new RTCSessionDescription(data.answer);
        await pc.setRemoteDescription(answerDescription);
      }
    });
  };

  // --- JOINER LOGIC ---
  const joinMultiplayerGame = async (code) => {
    if (!code) return alert("Please enter a Lobby Code!");
    code = code.toUpperCase();

    const gameDoc = doc(db, "games", code);
    const gameSnapshot = await getDoc(gameDoc);

    if (!gameSnapshot.exists() || !gameSnapshot.data().offer) {
      return alert("Lobby not ready or not found! Check the code.");
    }

    setIsHost(false);
    isHostRef.current = false;
    setIsMultiplayer(true);
    setConnectionStatus("connecting");
    setLobbyCode(code);

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });
    rtcRef.current = pc;

    pc.ondatachannel = (e) => setupDataChannel(e.channel);

    // 1. Wait for ALL ICE candidates to finish gathering
    pc.onicecandidate = async (e) => {
      // When e.candidate is null, gathering is done.
      if (!e.candidate) {
        console.log(
          "🟢 Joiner finished gathering ICE candidates. Writing Answer...",
        );
        await setDoc(
          gameDoc,
          {
            answer: {
              type: pc.localDescription.type,
              sdp: pc.localDescription.sdp,
            },
          },
          { merge: true },
        );
      }
    };

    // 2. Read the Host's offer (which already contains their network paths)
    const offer = gameSnapshot.data().offer;
    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    // 3. Create our Answer (This triggers onicecandidate to start searching)
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
  };

  // --- NATIVE WEBRTC LOGIC ---
  const setupDataChannel = (dc) => {
    dcRef.current = dc;

    dc.onopen = () => {
      console.log("🟢 DATA CHANNEL OPEN!");
      setConnectionStatus("connected");

      if (isHostRef.current) {
        // Send the current level state to the Joiner
        // This now includes goals, gameMode, and the specific board layout
        dc.send(
          JSON.stringify({
            type: "SYNC_STATE",
            board: board, // Current board (could be from editor or a loaded JSON)
            cols,
            rows,
            gameMode,
            goals: currentGoals,
            aiBehavior,
          }),
        );

        // Reset game state for the match
        setScores({ X: 0, O: 0, T: 0, S: 0 });
        setGameOver(false);
        setAppMode("local"); // Or a new 'multiplayer' mode if you prefer
      }
    };

    const broadcastCustomLevel = () => {
      if (isHost && dcRef.current?.readyState === "open") {
        dcRef.current.send(
          JSON.stringify({
            type: "SYNC_STATE",
            board,
            cols,
            rows,
            gameMode,
            goals: currentGoals,
            aiBehavior,
          }),
        );
        // Also reset local game state
        setScores({ X: 0, O: 0, T: 0, S: 0 });
        setDrawnLines([]);
        setGameOver(false);
      }
    };

    dc.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "SYNC_STATE") {
        // Reconstruct the Host's custom level
        setBoard(data.board);
        setCols(data.cols);
        setRows(data.rows);
        setGameMode(data.gameMode);
        setCurrentGoals(data.goals || [{ type: "standard", target: 0 }]);
        setAiBehavior(data.aiBehavior || "standard");

        // Reset Joiner's local scores/state
        setScores({ X: 0, O: 0, T: 0, S: 0 });
        setGameOver(false);
        setAppMode("local");
      } else if (data.type === "MOVE") {
        setPendingRemoteMove({ x: data.x, y: data.y, timestamp: Date.now() });
      }
    };

    dc.onclose = () => {
      alert("Opponent disconnected!");
      resetToTitle();
    };
  };

  useEffect(() => {
    if (pendingRemoteMove) {
      resolveTurn(pendingRemoteMove.x, pendingRemoteMove.y, true);
    }
  }, [pendingRemoteMove]);

  useEffect(() => {
    const stored = localStorage.getItem("t3_campaigns");
    if (stored) {
      setSavedCampaigns(JSON.parse(stored));
    } else {
      fetch("./default.json")
        .then((res) => res.json())
        .then((data) => {
          const defaultCamp = {
            id: "default",
            name: "CORE CAMPAIGN",
            levels: data,
          };
          setSavedCampaigns([defaultCamp]);
          localStorage.setItem("t3_campaigns", JSON.stringify([defaultCamp]));
        })
        .catch(() => {
          setSavedCampaigns([]);
          localStorage.setItem("t3_campaigns", "[]");
        });
    }
  }, []);

  const handleCampaignUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const campaignData = JSON.parse(event.target.result);
        const name = file.name.replace(/\.[^/.]+$/, ""); // Strip file extension

        if (!Array.isArray(campaignData))
          throw new Error("Invalid campaign format");

        const updatedCampaigns = [
          ...savedCampaigns,
          { id: generateId(), name, levels: campaignData },
        ];
        setSavedCampaigns(updatedCampaigns);
        localStorage.setItem("t3_campaigns", JSON.stringify(updatedCampaigns));
      } catch (err) {
        alert("Invalid campaign JSON file.");
        console.error(err);
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // Reset input to allow re-uploading the same file if needed
  };

  const loadCampaign = (id) => {
    const selected = savedCampaigns.find((c) => c.id === id);
    console.log(savedCampaigns, id, selected);
    if (selected) {
      setCampaign(selected.levels);
      setUnlockedLevels([0]); // Optional: Tie your hash-loading system here if needed
      setCampaignIndex(-1);
      setAppMode("campaign");
      loadLevel(selected.levels[0]);
    }
  };

  const deleteCampaign = (id, e) => {
    e.stopPropagation();
    if (id === "default") return alert("Cannot delete the core campaign.");

    const updated = savedCampaigns.filter((c) => c.id !== id);
    setSavedCampaigns(updated);
    localStorage.setItem("t3_campaigns", JSON.stringify(updated));
  };
  // Fail state for objective fail UI
  const [failState, setFailState] = useState(false);
  // Level unlocks for campaign
  const [unlockedLevels, setUnlockedLevels] = useState([0]); // Always unlock first level by default
  // App Navigation State
  const [appMode, setAppMode] = useState("title"); // title, local_setup, local, solo_setup, solo, campaign_select, campaign, editor, multiplayer_setup
  const [gameMode, setGameMode] = useState("standard"); // standard, zone_control, corruption, turf_wars, pulse_blitz, cascade, mirror_protocol
  const [pulseTime, setPulseTime] = useState(100); // Percentage 0-100
  const pulseInterval = 3000; // 3 seconds per turn in Blitz, pulse_blitz, cascade, mirror_protocol
  const [isPlaytesting, setIsPlaytesting] = useState(false);
  const [backupState, setBackupState] = useState(null);

  const isBuildMode = appMode === "editor" && !isPlaytesting;

  // Grid & Board State
  const [cols, setCols] = useState(DEFAULT_COLS);
  const [rows, setRows] = useState(DEFAULT_ROWS);
  const [board, setBoard] = useState(
    createEmptyBoard(DEFAULT_COLS, DEFAULT_ROWS),
  );

  // UI Config
  const [iconSizes, setIconSizes] = useState({
    X: 40,
    O: 40,
    T: 40,
    S: 40,
    neutral: 32,
    trash: 32,
    flip: 32,
    dup: 32,
    locked_mech: 32,
    locked_letter: 32,
    switch: 32,
    rot_cw: 32,
    rot_ccw: 32,
    mov: 42,
    zap: 42,
  });

  const getCellBgIcon = (cell) => {
    switch (cell.type) {
      case "neutral":
        return "Neutral";
      case "trash":
        return "Trash";
      case "dup":
        return "Duplicator";
      case "rot_cw":
      case "rot_ccw":
        return "Rotate";
      case "locked_letter":
        return `Letterlock ${"DCBA".indexOf(cell.letter) + 1}`;
      case "switch":
        return `Switch ${"DCBA".indexOf(cell.letter) + 1}`;
      case "mov":
        return "Mover";
      case "zap":
        return "Zap";
      default:
        if (cell.flipMod || cell.type === "flip") return "Flip";
        if (cell.mechanicalLock) return "Lock";
        return null;
    }
  };

  // Game State
  const [activePlayers, setActivePlayers] = useState(["X", "O"]);
  const [currentPlayer, setCurrentPlayer] = useState("X");
  const [scores, setScores] = useState({ X: 0, O: 0, T: 0, S: 0 });
  const [drawnLines, setDrawnLines] = useState([]);
  const [extraTurns, setExtraTurns] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [winMessage, setWinMessage] = useState(""); // Campaign & Goals

  const [campaign, setCampaign] = useState([]);
  const [campaignIndex, setCampaignIndex] = useState(-1);
  const [currentGoals, setCurrentGoals] = useState([
    { type: "standard", target: 0 },
  ]);
  const [movesMade, setMovesMade] = useState(0);
  const [maxComboAchieved, setMaxComboAchieved] = useState(0);

  // Visual Novel Dialog
  const [dialogs, setDialogs] = useState([]);
  const [showDialog, setShowDialog] = useState(false);
  const [dialogIndex, setDialogIndex] = useState(0);

  useEffect(() => {
    if (
      gameMode !== "pulse_blitz" ||
      gameOver ||
      currentPlayer === null ||
      (!["local", "solo", "campaign"].includes(appMode) && !isPlaytesting)
    )
      return;

    setPulseTime(100);
    const step = 100; // ms
    const decrement = (step / pulseInterval) * 100;

    const timer = setInterval(() => {
      setPulseTime((prev) => {
        if (prev <= 0) {
          setCurrentPlayer(
            (p) =>
              activePlayers[
                (activePlayers.indexOf(p) + 1) % activePlayers.length
              ],
          );
          return 100;
        }
        return prev - decrement;
      });
    }, step);

    return () => clearInterval(timer);
  }, [
    gameMode,
    currentPlayer,
    gameOver,
    isPlaytesting,
    appMode,
    activePlayers,
  ]);

  const skipDialog = () => {
    setShowDialog(false);
    setDialogIndex(dialogs.length);
  };

  // --- GAMEPLAY EXPANSIONS LOGIC ---
  useEffect(() => {
    if (movesMade === 0 || gameOver) return;

    let nextBoard = JSON.parse(JSON.stringify(board));
    let boardChanged = false;

    // 1. Zone Control: Reset targets every 5 rounds (10 moves)
    if (gameMode === "zone_control" && movesMade % 10 === 0) {
      let isFull = nextBoard.every((r) =>
        r.every((c) => c.piece || c.type === "void"),
      );
      if (!isFull) {
        let zoneLineIds = new Set();
        nextBoard.forEach((row) =>
          row.forEach((cell) => {
            if (cell.isTarget && cell.lineId) {
              zoneLineIds.add(cell.lineId);
            }
          }),
        );

        nextBoard.forEach((row) =>
          row.forEach((cell) => {
            if (cell.isTarget) {
              if (cell.piece) {
                cell.piece = null;
                cell.dead = false;
                cell.lineId = null;
                boardChanged = true;
              }
            } else if (cell.lineId && zoneLineIds.has(cell.lineId)) {
              cell.dead = false;
              cell.lineId = null;
              boardChanged = true;
            }
          }),
        );

        if (boardChanged) {
          setDrawnLines((prev) =>
            prev.filter((line) => !zoneLineIds.has(line.id)),
          );
        }
      }
    }

    // 2. The Corruption: Void spread at turn end
    if (gameMode === "corruption") {
      let validSpaces = [];
      nextBoard.forEach((row, y) =>
        row.forEach((cell, x) => {
          const bl = [
            "dup",
            "zap",
            "mov",
            "rot_cw",
            "rot_ccw",
            "neutral",
            "target",
            "void",
            "switch",
            "locked_letter",
          ];
          if (!bl.includes(cell.type) && !cell.dead && !cell.piece)
            validSpaces.push({ x, y });
        }),
      );

      if (validSpaces.length > 0) {
        let rand = validSpaces[Math.floor(Math.random() * validSpaces.length)];
        nextBoard[rand.y][rand.x].type = "void";
        nextBoard[rand.y][rand.x].piece = null;
        boardChanged = true;
      }
    }

    if (boardChanged) setBoard(nextBoard);
  }, [movesMade, gameMode, gameOver]);

  // 3. Turf Wars: Area Control Continuous Tally
  useEffect(() => {
    if (gameMode === "turf_wars") {
      let newScores = { X: 0, O: 0, T: 0, S: 0 };
      board.flat().forEach((cell) => {
        if (cell.piece && newScores[cell.piece] !== undefined) {
          newScores[cell.piece]++;
        }
      });
      setScores((prev) => ({ ...prev, ...newScores }));

      if (gameOver) {
        let maxScore = -1;
        let winners = [];
        activePlayers.forEach((p) => {
          if (newScores[p] > maxScore) {
            maxScore = newScores[p];
            winners = [p];
          } else if (newScores[p] === maxScore) {
            winners.push(p);
          }
        });

        setWinMessage(
          winners.length === 1
            ? `${winners[0]} Wins Turf War!`
            : `Turf War Tie between ${winners.join(", ")}!`,
        );
      }
    }
  }, [board, gameMode, gameOver, activePlayers]);

  // Editor State
  const [editorTab, setEditorTab] = useState("tools");
  const [aiBehavior, setAiBehavior] = useState("standard");
  const [editorTool, setEditorTool] = useState("empty");
  const [editorDir, setEditorDir] = useState("r");
  const [editorLetter, setEditorLetter] = useState("A");
  const [selectedLevelIndex, setSelectedLevelIndex] = useState(-1);
  const [draggedIndex, setDraggedIndex] = useState(-1);
  const [renamingIndex, setRenamingIndex] = useState(-1);
  const [aiDiff, setAiDiff] = useState("hard");
  const [playtestMode, setPlaytestMode] = useState("standard");

  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  useEffect(() => {
    const isBotActive =
      appMode === "solo" ||
      (appMode === "campaign" &&
        currentGoals.some((g) => g.type === "standard")) ||
      (isPlaytesting && playtestMode === "standard");

    if (isBotActive && currentPlayer !== "X" && !gameOver) {
      if (isBotActive && currentPlayer !== "X" && !gameOver) {
        const timer = setTimeout(() => {
          // Example of passing parameters based on a level goal or hardcoded state
          const move = getProceduralMove(
            board,
            currentPlayer,
            rows,
            cols,
            aiDiff,
            aiBehavior,
            gameMode,
            activePlayers,
          );
          if (move) {
            resolveTurn(move.x, move.y);
          }
        }, 400);

        return () => clearTimeout(timer);
      }
    }
  }, [
    currentPlayer,
    appMode,
    currentGoals,
    board,
    gameOver,
    aiDiff,
    aiBehavior,
    activePlayers,
  ]);

  useEffect(() => {
    const saved = localStorage.getItem("ttt2_campaign_autosave");
    if (saved && appMode === "editor") {
      setTimeout(() => {
        if (
          window.confirm(
            "An autosaved campaign was found. Would you like to recover it?",
          )
        ) {
          try {
            setCampaign(JSON.parse(saved));
            setSelectedLevelIndex(0);
            loadLevel(JSON.parse(saved)[0]);
          } catch (e) {
            console.error("Autosave corrupted", e);
          }
        } else {
          localStorage.removeItem("ttt2_campaign_autosave");
        }
      }, 500);
    }
  }, [appMode]);

  useEffect(() => {
    if (!campaign || campaign.length === 0) return;
    console.log("Autosaving campaign state...");

    const interval = setInterval(() => {
      // 1. Sync current working level into the campaign array if a level is selected
      if (selectedLevelIndex >= 0 && selectedLevelIndex < campaign.length) {
        setCampaign((prev) => {
          const updated = [...prev];
          updated[selectedLevelIndex] = {
            ...updated[selectedLevelIndex],
            gameMode,
            cols,
            rows,
            board,
            dialogs,
            goals: currentGoals,
            aiBehavior,
            activePlayers,
          };
          return updated;
        });
      }

      // 2. Persist the entire campaign state to localStorage
      const currentState = JSON.stringify(campaign);
      const lastSaved = localStorage.getItem("ttt2_campaign_autosave");
      if (currentState !== lastSaved) {
        localStorage.setItem("ttt2_campaign_autosave", currentState);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [campaign, board, currentGoals, dialogs, gameMode, selectedLevelIndex]);

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e, dropIndex) => {
    e.preventDefault();
    const dragIndex = draggedIndex;
    setDraggedIndex(-1);

    if (dragIndex === dropIndex) return;

    const newCampaign = [...campaign];
    const draggedItem = newCampaign[dragIndex];
    newCampaign.splice(dragIndex, 1);
    newCampaign.splice(dropIndex, 0, draggedItem);

    setCampaign(newCampaign);

    // Update selected index if it was affected
    if (selectedLevelIndex === dragIndex) {
      setSelectedLevelIndex(dropIndex);
    } else if (
      selectedLevelIndex > dragIndex &&
      selectedLevelIndex <= dropIndex
    ) {
      setSelectedLevelIndex(selectedLevelIndex - 1);
    } else if (
      selectedLevelIndex < dragIndex &&
      selectedLevelIndex >= dropIndex
    ) {
      setSelectedLevelIndex(selectedLevelIndex + 1);
    }
  };

  // Figma Canvas State
  const [pan, setPan] = useState({ x: 50, y: 50 });
  const [zoom, setZoom] = useState(1);
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);
  const isDragging = useRef(false);
  const lastMouseDir = useRef("r"); // Tracks raw mouse movement direction
  const lastMouse = useRef({ x: 0, y: 0 });
  const canvasRef = useRef(null);

  useEffect(() => {
    fetch("./default.json")
      .then((res) => res.json())
      .then((data) => setCampaign(data))
      .catch(() => setCampaign([]));
    setUnlockedLevels([0]);
  }, []);

  // --- KEYBOARD & MOUSE TRACKING ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;

      const PAN_SPEED = 40;
      if (e.key === "ArrowUp") setPan((p) => ({ ...p, y: p.y + PAN_SPEED }));
      if (e.key === "ArrowDown") setPan((p) => ({ ...p, y: p.y - PAN_SPEED }));
      if (e.key === "ArrowLeft") setPan((p) => ({ ...p, x: p.x + PAN_SPEED }));
      if (e.key === "ArrowRight") setPan((p) => ({ ...p, x: p.x - PAN_SPEED }));

      if (e.code === "Space") {
        setIsSpaceHeld(true);
        e.preventDefault(); // Prevents page scrolling down
      }
    };

    const handleKeyUp = (e) => {
      if (e.code === "Space") {
        setIsSpaceHeld(false);
        isDragging.current = false; // Immediately stop panning
      }
    };

    const handleGlobalPointerMove = (e) => {
      // Dynamic Direction Tracking for Painter Tool
      if (Math.abs(e.movementX) > 2 || Math.abs(e.movementY) > 2) {
        if (Math.abs(e.movementX) > Math.abs(e.movementY)) {
          lastMouseDir.current = e.movementX > 0 ? "r" : "l";
        } else {
          lastMouseDir.current = e.movementY > 0 ? "d" : "u";
        }
      }
    };

    const handleBlur = () => {
      setIsSpaceHeld(false);
      isDragging.current = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    document.addEventListener("pointermove", handleGlobalPointerMove);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      document.removeEventListener("pointermove", handleGlobalPointerMove);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const resetToTitle = () => {
    setCols(DEFAULT_COLS);
    setRows(DEFAULT_ROWS);
    setBoard(createEmptyBoard(DEFAULT_COLS, DEFAULT_ROWS));
    setDialogs([]);
    setScores({ X: 0, O: 0, T: 0, S: 0 });
    setDrawnLines([]);
    setExtraTurns(0);
    setCurrentPlayer("X");
    setActivePlayers(["X", "O"]);
    setGameOver(false);
    setIsPlaytesting(false);
    setBackupState(null);
    setPan({ x: 50, y: 50 }); // Reset Camera
    setZoom(1);
    setAppMode("title");
    setFailState(false);
    setMovesMade(0);
    setMaxComboAchieved(0);
  };

  // --- FIGMA CANVAS LOGIC (PORTED FROM ARCHITECT) ---
  const handleWheel = (e) => {
    if (
      appMode.includes("setup") ||
      appMode === "title" ||
      appMode === "campaign_select"
    )
      return;
    e.preventDefault();

    const zoomSensitivity = 0.001;
    const delta = -e.deltaY * zoomSensitivity;
    const nextZoom = Math.max(0.2, Math.min(zoom + delta, 3));

    // Zoom toward cursor location
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldX = (mouseX - pan.x) / zoom;
    const worldY = (mouseY - pan.y) / zoom;

    setPan({
      x: mouseX - worldX * nextZoom,
      y: mouseY - worldY * nextZoom,
    });
    setZoom(nextZoom);
  };

  const handlePointerDown = (e) => {
    lastMouse.current = { x: e.clientX, y: e.clientY };

    // Middle-click or Alt+Left-click to Pan
    if (e.button === 1 || (e.button === 0 && (e.altKey || isSpaceHeld))) {
      isDragging.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    // Otherwise, handle regular grid interaction
    // (Logic for handleCellInteract moved here or kept as separate check)
  };

  const handlePointerMove = (e) => {
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };

    if (isDragging.current) {
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
    }
  };

  const handlePointerUp = (e) => {
    isDragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // --- CORE LOGIC ENGINE ---
  const resolveTurn = (startX, startY, isRemoteMove = false) => {
    if (isMultiplayer && !isRemoteMove) {
      if (
        (isHost && currentPlayer !== "X") ||
        (!isHost && currentPlayer === "X")
      ) {
        return; // Ignore clicks if it's the other person's turn
      }

      // Send the move to the other player via Native DataChannel
      if (dcRef.current && dcRef.current.readyState === "open") {
        dcRef.current.send(
          JSON.stringify({ type: "MOVE", x: startX, y: startY }),
        );
      }
    }
    const applyGravity = (b) => {
      let newBoard = JSON.parse(JSON.stringify(b));
      let changed = true;
      const blockingTypes = [
        "void",
        "locked_mech",
        "locked_letter",
        "rot_cw",
        "rot_ccw",
        "dup",
        "neutral",
      ];

      while (changed) {
        changed = false;
        for (let x = 0; x < cols; x++) {
          for (let y = rows - 2; y >= 0; y--) {
            const current = newBoard[y][x];
            const below = newBoard[y + 1][x];

            if (
              current.piece &&
              !current.mechanicalLock &&
              current.type !== "locked_mech" &&
              !current.walls?.b
            ) {
              if (
                !below.piece &&
                !below.mechanicalLock &&
                !blockingTypes.includes(below.type)
              ) {
                below.piece = current.piece;
                below.rotation = current.rotation;
                current.piece = null;
                changed = true;
              }
            }
          }
        }
      }
      return newBoard;
    };

    let matchOver = false;
    let wMsg = "";
    let b = JSON.parse(JSON.stringify(board));
    let q = [{ x: startX, y: startY, piece: currentPlayer, overwrite: false }];

    if (gameMode === "mirror_protocol") {
      let mx = cols - 1 - startX;
      if (mx >= 0 && mx < cols) {
        let mCell = b[startY][mx];
        if (
          !mCell.piece &&
          !mCell.mechanicalLock &&
          mCell.type !== "void" &&
          mCell.type !== "locked_mech" &&
          mCell.type !== "locked_letter"
        ) {
          q.push({ x: mx, y: startY, piece: currentPlayer, overwrite: false });
        }
      }
    }
    if (gameMode === "mirror_protocol") {
      let mx = cols - 1 - startX;
      if (mx >= 0 && mx < cols) {
        let mCell = b[startY][mx];
        if (
          !mCell.piece &&
          !mCell.mechanicalLock &&
          mCell.type !== "void" &&
          mCell.type !== "locked_mech" &&
          mCell.type !== "locked_letter"
        ) {
          q.push({ x: mx, y: startY, piece: currentPlayer, overwrite: false });
        }
      }
    }

    let linesToErase = new Set();
    let maxComboThisTurn = 0;
    // Step 2: End level if no moves left (after matchOver/wMsg are set)
    if (!matchOver) {
      let hasPlayable = false;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const cell = b[y][x];
          if (
            cell.type !== "void" &&
            cell.type !== "locked_mech" &&
            !cell.mechanicalLock &&
            cell.type !== "dup" &&
            cell.type !== "neutral" &&
            cell.type !== "locked_letter" &&
            !cell.piece
          ) {
            hasPlayable = true;
            break;
          }
        }
        if (hasPlayable) break;
      }
      if (!hasPlayable) {
        matchOver = true;
        wMsg = wMsg || "No more moves!";
      }
    }

    const processReactions = (queue) => {
      let iters = 0;
      const isBlocker = (c) => {
        if (!c) return true;
        // Machines are physical obstacles for pieces being moved/zapped
        const machines = [
          "dup",
          "rot_cw",
          "rot_ccw",
          "neutral",
          "trash",
          "flip",
          "switch",
        ];
        if (machines.includes(c.type)) return true;
        if (c.type === "void") return true;
        if (c.type === "locked_letter" && !c.unlocked) return true;
        if (c.piece) return true;
        return false;
      };

      while (queue.length > 0 && iters < MAX_ITERATIONS) {
        iters++;
        let { x, y, piece, overwrite, rotation } = queue.shift();
        if (y < 0 || y >= rows || x < 0 || x >= cols) continue;
        if (b[y][x].type === "void") continue;

        let cx = x,
          cy = y;

        // Trace Zap Path (Pile up logic)
        if (b[cy][cx].type === "zap") {
          while (true) {
            let current = b[cy][cx];
            let dir = current.dir;
            let nx = cx + (dir === "r" ? 1 : dir === "l" ? -1 : 0);
            let ny = cy + (dir === "d" ? 1 : dir === "u" ? -1 : 0);

            if (ny < 0 || ny >= rows || nx < 0 || nx >= cols) break;
            let nextCell = b[ny][nx];

            let wallBlocked =
              (dir === "r" && current.walls.r) ||
              (dir === "l" && nextCell.walls.r) ||
              (dir === "d" && current.walls.b) ||
              (dir === "u" && nextCell.walls.b);

            // If the very next space is a machine/piece/wall, we stop immediately (pile up)
            if (wallBlocked || (isBlocker(nextCell) && !overwrite)) break;

            // If we have overwrite (Dup power), we can land on pieces, but still not machines
            if (overwrite && nextCell.piece) {
              cx = nx;
              cy = ny;
              break;
            }

            cx = nx;
            cy = ny;
            // Zaps only allow sliding if the current tile is a zap tile
            if (nextCell.type !== "zap") break;
          }
        }

        let cell = b[cy][cx];

        // Final check: If we landed on a blocker and don't have overwrite, we can't place
        if (!overwrite && isBlocker(cell)) continue;

        // Locked/Hard blocks are impassable regardless of overwrite
        if (
          cell.type === "void" ||
          (cell.type === "locked_letter" && !cell.unlocked)
        )
          continue;
        // Dup/Rotators/Neutral are actors, not containers
        if (["dup", "rot_cw", "rot_ccw", "neutral"].includes(cell.type))
          continue;

        if (cell.flipMod || cell.type === "flip") {
          let idx = activePlayers.indexOf(piece);
          piece = activePlayers[(idx + 1) % activePlayers.length];
        }

        const checkDup = (dx, dy, targetDir, pushX, pushY) => {
          let neighbor = b[cy + dy]?.[cx + dx];
          if (neighbor?.type === "dup" && neighbor.dir === targetDir) {
            queue.push({
              x: cx + pushX,
              y: cy + pushY,
              piece,
              overwrite: true,
              rotation,
            });
          }
        };

        checkDup(1, 0, "r", 2, 0);
        checkDup(-1, 0, "l", -2, 0);
        checkDup(0, 1, "d", 0, 2);
        checkDup(0, -1, "u", 0, -2);

        if (cell.type === "trash") continue;

        // Handle Overwrite (Duplicator eating pieces)
        if (cell.piece && cell.dead && overwrite && cell.lineId) {
          linesToErase.add(cell.lineId);
        }

        cell.piece = piece;
        if (rotation !== undefined) cell.rotation = rotation;
        cell.dead = false;
        cell.lineId = null;

        if (cell.type === "switch") {
          b.forEach((r) =>
            r.forEach((c) => {
              if (c.type === "locked_letter" && c.letter === cell.letter)
                c.unlocked = true;
            }),
          );
        }
      }
      console.log(
        `Processed reactions in ${iters} iterations, erasing ${linesToErase.size} lines.`,
      );
    };

    processReactions(q);

    let machineChanged = true;
    let machineIters = 0;
    const MAX_MACHINE_ITERS = 10;

    while (machineChanged && machineIters < MAX_MACHINE_ITERS) {
      machineChanged = false;
      machineIters++;

      const priorityTiers = [["rot_cw"], ["rot_ccw"], ["mov"]];

      priorityTiers.forEach((tier) => {
        let moverQueue = [];
        b.forEach((row, y) => {
          row.forEach((cell, x) => {
            if (!tier.includes(cell.type)) return;

            // Handle Movers: Respect occupancy (no eating)
            if (cell.type === "mov" && cell.piece && !cell.dead) {
              let nx = x + (cell.dir === "r" ? 1 : cell.dir === "l" ? -1 : 0);
              let ny = y + (cell.dir === "d" ? 1 : cell.dir === "u" ? -1 : 0);

              let wallBlocked =
                (cell.dir === "r" && cell.walls.r) ||
                (cell.dir === "l" && nx >= 0 && b[ny][nx].walls.r) ||
                (cell.dir === "d" && cell.walls.b) ||
                (cell.dir === "u" && ny >= 0 && b[ny][nx].walls.b);

              if (
                !wallBlocked &&
                nx >= 0 &&
                nx < cols &&
                ny >= 0 &&
                ny < rows &&
                b[ny][nx].type !== "void" &&
                b[ny][nx].type !== "dup" &&
                b[ny][nx].type !== "neutral"
              ) {
                if (b[ny][nx].type === "locked_letter" && !b[ny][nx].unlocked)
                  return;
                let target = b[ny][nx];
                // Movers only move if the destination is empty
                if (
                  !target.piece &&
                  ["dup", "rot_cw", "rot_ccw"].includes(target.type) === false
                ) {
                  moverQueue.push({
                    from: { x, y },
                    to: { x: nx, y: ny },
                    piece: cell.piece,
                    rotation: cell.rotation || 0,
                    isRot: false,
                  });
                }
              }
            }

            // Handle Rotators: Standard logic
            if (
              (cell.type === "rot_cw" || cell.type === "rot_ccw") &&
              !cell.dead
            ) {
              let isCW = cell.type === "rot_cw";
              [
                [0, -1],
                [1, 0],
                [0, 1],
                [-1, 0],
              ].forEach(([dx, dy]) => {
                let px = x + dx,
                  py = y + dy;
                if (
                  px >= 0 &&
                  px < cols &&
                  py >= 0 &&
                  py < rows &&
                  b[py][px].piece &&
                  !b[py][px].dead
                ) {
                  let nx = x + (isCW ? -dy : dy),
                    ny = y + (isCW ? dx : -dx);
                  if (
                    nx >= 0 &&
                    nx < cols &&
                    ny >= 0 &&
                    ny < rows &&
                    b[ny][nx].type !== "void"
                  ) {
                    let t = b[ny][nx];
                    if (
                      !t.piece &&
                      !t.type.startsWith("locked") &&
                      t.type !== "dup" &&
                      t.type !== "neutral"
                    ) {
                      moverQueue.push({
                        from: { x: px, y: py },
                        to: { x: nx, y: ny },
                        piece: b[py][px].piece,
                        rotation: b[py][px].rotation || 0,
                        isRot: true,
                        isCW,
                      });
                    }
                  }
                }
              });
            }
          });
        });

        if (moverQueue.length === 0) return;

        let uniqueMoves = [];
        let claimedSources = new Set();
        moverQueue.forEach((m) => {
          let sKey = `${m.from.x},${m.from.y}`;
          if (!claimedSources.has(sKey)) {
            claimedSources.add(sKey);
            uniqueMoves.push(m);
          }
        });

        uniqueMoves.forEach((m) => {
          b[m.from.y][m.from.x].piece = null;
        });

        uniqueMoves.forEach((m) => {
          let targetRot = m.isRot
            ? m.rotation + (m.isCW ? 90 : -90)
            : m.rotation;
          b[m.to.y][m.to.x].piece = m.piece;
          b[m.to.y][m.to.x].rotation = targetRot;
        });

        // Trigger reactions (including potential Duplicators) for moved pieces
        processReactions(
          uniqueMoves.map((m) => ({
            x: m.to.x,
            y: m.to.y,
            piece: m.piece,
            rotation: b[m.to.y][m.to.x].rotation,
            overwrite: false,
          })),
        );
      });

      // Handle Duplicators: Check for "Input" pieces behind the Duplicator
      b.forEach((row, y) => {
        row.forEach((cell, x) => {
          if (cell.type === "dup" && !cell.dead) {
            const dirMap = {
              r: [-1, 0, 1, 0],
              l: [1, 0, -1, 0],
              d: [0, -1, 0, 1],
              u: [0, 1, 0, -1],
            };
            const [inX, inY, outX, outY] = dirMap[cell.dir] || [0, 0, 0, 0];

            let inputCell = b[y + inY]?.[x + inX];
            if (inputCell && inputCell.piece && !inputCell.dead) {
              // We found a piece behind the dup! Fire a reaction to the output side
              processReactions([
                {
                  x: x + outX,
                  y: y + outY,
                  piece: inputCell.piece,
                  rotation: inputCell.rotation || 0,
                  overwrite: true,
                },
              ]);
            }
          }
        });
      });
    }

    let tempScores = { ...scores };
    let tempDrawnLines = [...drawnLines];

    if (linesToErase.size > 0) {
      linesToErase.forEach((id) => {
        let owner = null;
        b.forEach((row) =>
          row.forEach((c) => {
            if (c.lineId === id) {
              owner = c.piece;
              c.dead = false;
              c.lineId = null;
            }
          }),
        );
        if (owner) tempScores[owner]--;
        tempDrawnLines = tempDrawnLines.filter((d) => d.id !== id);
      });
    }

    let earnedExtraTurns = 0;
    let linesFound = [];
    if (gameMode === "cascade") {
      b = applyGravity(b);
    }

    const checkLine = (startX, startY, dx, dy) => {
      let run = [];
      let cx = startX,
        cy = startY;

      const scoreRun = () => {
        activePlayers.forEach((player) => {
          let currentSeq = [];
          run.forEach((item) => {
            let p = item.cell.piece;
            let isDead = item.cell.dead;
            let isWild = item.cell.type === "neutral";
            if (!isDead && (p === player || isWild)) {
              currentSeq.push(item);
            } else {
              evalSeq(currentSeq, player);
              currentSeq = [];
            }
          });
          evalSeq(currentSeq, player);
        });
      };

      const evalSeq = (seq, player) => {
        let firstIdx = seq.findIndex((i) => i.cell.piece === player);
        let lastIdx = seq.findLastIndex((i) => i.cell.piece === player);
        if (firstIdx !== -1 && lastIdx !== -1 && lastIdx - firstIdx + 1 >= 3) {
          linesFound.push({ player, seq: seq.slice(firstIdx, lastIdx + 1) });
        }
      };

      while (cx >= 0 && cx < cols && cy >= 0 && cy < rows) {
        let cell = b[cy][cx];
        if (cell.type === "void") {
          scoreRun();
          run = [];
          cx += dx;
          cy += dy;
          continue;
        }

        let nextX = cx + dx,
          nextY = cy + dy;
        let blocked = false;

        if (nextX >= 0 && nextX < cols && nextY >= 0 && nextY < rows) {
          if (dx === 1 && dy === 0 && cell.walls.r) blocked = true;
          if (dx === 0 && dy === 1 && cell.walls.b) blocked = true;

          if (dx === 1 && dy === 1 && b[cy]?.[nextX]?.walls?.bl) blocked = true;
          if (dx === -1 && dy === 1 && b[cy]?.[nextX]?.walls?.br)
            blocked = true;
        } else {
          blocked = true;
        }

        run.push({ x: cx, y: cy, cell });
        if (blocked) {
          scoreRun();
          run = [];
        }
        cx = nextX;
        cy = nextY;
      }
      if (run.length > 0) scoreRun();
    };

    for (let y = 0; y < rows; y++) checkLine(0, y, 1, 0);
    for (let x = 0; x < cols; x++) checkLine(x, 0, 0, 1);
    for (let y = 0; y < rows; y++) checkLine(0, y, 1, 1);
    for (let x = 1; x < cols; x++) checkLine(x, 0, 1, 1);
    for (let y = 0; y < rows; y++) checkLine(cols - 1, y, -1, 1);
    for (let x = 0; x < cols - 1; x++) checkLine(x, 0, -1, 1);

    let pointsScoredThisTurn = 0;

    linesFound.forEach((line) => {
      const lId = generateId();

      let lineScore = 1;
      if (gameMode === "zone_control") {
        lineScore = 0;
        line.seq.forEach((item) => {
          if (b[item.y][item.x].isTarget) lineScore++;
        });
      }

      tempScores[line.player] += lineScore;

      if (line.player === currentPlayer) {
        pointsScoredThisTurn++;
        let longLineBonus = Math.max(0, line.seq.length - 3);
        earnedExtraTurns += longLineBonus;
        maxComboThisTurn = Math.max(maxComboThisTurn, longLineBonus);
      }

      line.seq.forEach((item) => {
        if (b[item.y][item.x].type !== "neutral") b[item.y][item.x].dead = true;
        b[item.y][item.x].lineId = lId;
      });

      const playerColors = {
        X: "#22d3ee",
        O: "#fb7185",
        T: "#34d399",
        S: "#fbbf24",
      };
      tempDrawnLines.push({
        id: lId,
        x1: line.seq[0].x,
        y1: line.seq[0].y,
        x2: line.seq[line.seq.length - 1].x,
        y2: line.seq[line.seq.length - 1].y,
        color: playerColors[line.player] || "#ffffff",
      });
    });

    if (pointsScoredThisTurn > 1) {
      earnedExtraTurns += pointsScoredThisTurn - 1;
    }

    // Check if there are any valid moves left for any player (for campaign/solo, only X matters)
    let isFull = true;
    let targetsTotal = 0;
    let targetsFilled = 0;
    let foundValidMove = false;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const c = b[y][x];
        if (c.type === "void") continue;
        // Track targets for goal logic
        if (c.isTarget) {
          targetsTotal++;
          if (c.piece === "X") targetsFilled++;
        }
        // Check for valid moves for current player (X in solo/campaign, X or O in local)
        if (!c.piece) {
          if (
            [
              "empty",
              "zap",
              "mov",
              "rot_cw",
              "rot_ccw",
              "flip",
              "switch",
            ].includes(c.type)
          ) {
            foundValidMove = true;
          }
          if (c.type === "locked_letter" && c.unlocked) {
            foundValidMove = true;
          }
        }
        // Check lock dots last
        if (!c.piece && (c.type === "locked_mech" || c.mechanicalLock)) {
          // Only allow if rules permit (customize if needed)
          // For now, treat as not a valid move
        }
      }
    }
    if (foundValidMove) isFull = false;

    setBoard(b);
    setScores(tempScores);
    setDrawnLines(tempDrawnLines);

    let currentMoves = currentPlayer === "X" ? movesMade + 1 : movesMade;
    let currentMaxCombo = Math.max(maxComboAchieved, maxComboThisTurn);
    if (currentPlayer === "X") {
      setMovesMade(currentMoves);
    }
    setMaxComboAchieved(currentMaxCombo);

    if (appMode === "local" || (isPlaytesting && playtestMode === "manual")) {
      if (isFull) {
        matchOver = true;
        let maxScore = -1;
        let winners = [];
        activePlayers.forEach((p) => {
          if (tempScores[p] > maxScore) {
            maxScore = tempScores[p];
            winners = [p];
          } else if (tempScores[p] === maxScore) {
            winners.push(p);
          }
        });
        wMsg =
          winners.length === 1
            ? `Player ${winners[0]} Wins!`
            : `Tie between ${winners.join(", ")}!`;
      }
    } else if (
      appMode === "solo" ||
      appMode === "campaign" ||
      (isPlaytesting && playtestMode === "standard")
    ) {
      let failState = false;
      let allMet = true;
      let anyFailed = false;
      let failMsg = "";
      let requiresFullBoard = currentGoals.some((g) => g.type === "standard");
      let forcedEnd = currentGoals.some(
        (g) =>
          g.type === "max_moves" &&
          g.mode === "end" &&
          currentMoves >= g.target,
      );
      let isEndState = isFull || forcedEnd;

      currentGoals.forEach((g) => {
        if (g.type === "standard") {
          let aiMax = 0;
          activePlayers.forEach((p) => {
            if (p !== "X" && tempScores[p] > aiMax) aiMax = tempScores[p];
          });
          if (isEndState && tempScores.X <= aiMax) {
            anyFailed = true;
            failMsg = "Failed: Score too low.";
          }
          if (!isEndState) allMet = false;
        } else if (g.type === "exact_score") {
          if (tempScores.X !== g.target) allMet = false;
          if (isEndState && tempScores.X !== g.target) {
            anyFailed = true;
            failMsg = `Failed: Needed exactly ${g.target} points.`;
          }
        } else if (g.type === "min_score") {
          if (tempScores.X < g.target) allMet = false;
          if (isEndState && tempScores.X < g.target) {
            anyFailed = true;
            failMsg = `Failed: Needed at least ${g.target} points.`;
          }
        } else if (g.type === "max_score") {
          if (tempScores.X > g.target) {
            anyFailed = true;
            failMsg = `Failed: Exceeded max score of ${g.target}.`;
          }
        } else if (g.type === "fill_targets") {
          if (targetsTotal === 0 || targetsFilled < targetsTotal)
            allMet = false;
          if (
            isEndState &&
            (targetsTotal === 0 || targetsFilled < targetsTotal)
          ) {
            anyFailed = true;
            failMsg = "Failed: Not all targets filled.";
          }
        } else if (g.type === "min_combo") {
          if (currentMaxCombo < g.target) allMet = false;
          if (isEndState && currentMaxCombo < g.target) {
            anyFailed = true;
            failMsg = `Failed: Needed a combo of ${g.target}.`;
          }
        } else if (g.type === "max_moves") {
          if (currentMoves > g.target && (!g.mode || g.mode === "fail")) {
            anyFailed = true;
            failMsg = `Failed: Exceeded limit of ${g.target} moves.`;
          }
        }
      });

      if (anyFailed) {
        matchOver = true;
        wMsg = failMsg;
        failState = true;
      } else if (allMet && (!requiresFullBoard || isEndState)) {
        matchOver = true;
        wMsg = "Objectives Complete! You Win!";
        failState = false;
      } else if (isEndState) {
        matchOver = true;
        wMsg = "Game Over: Out of moves and objectives not met.";
        failState = true;
      }

      setTimeout(() => setFailState?.(failState), 0);
    }

    setGameOver(matchOver);
    if (matchOver) setWinMessage(wMsg);

    let totalExtra = extraTurns + earnedExtraTurns;
    if (totalExtra > 0) {
      setExtraTurns(totalExtra - 1);
    } else {
      setCurrentPlayer((p) => {
        if (
          (appMode === "solo" || appMode === "campaign") &&
          !currentGoals.some((g) => g.type === "standard")
        )
          return "X";
        return activePlayers[
          (activePlayers.indexOf(p) + 1) % activePlayers.length
        ];
      });
    }
  };

  const handleCellInteract = (x, y, e) => {
    if (isDragging.current) return; // Prevent painting while panning
    if (e.type === "pointerdown" && e.button !== 0) return; // Only left-click
    if (e.type === "pointerenter" && (e.buttons !== 1 || !isBuildMode)) return;
    if (gameOver && !isBuildMode) return;

    if (isBuildMode) {
      let b = [...board];
      b[y] = [...b[y]];

      if (editorTool === "target_toggle") {
        if (e.type === "pointerdown") b[y][x].isTarget = !b[y][x].isTarget;
        else if (e.type === "pointerenter" && e.buttons === 1)
          b[y][x].isTarget = !b[y][x].isTarget; // Drag to toggle targets
      } else if (editorTool.startsWith("place_")) {
        if (
          e.type === "pointerdown" ||
          (e.type === "pointerenter" && e.buttons === 1)
        ) {
          const piece = editorTool.split("_")[1].toUpperCase();
          b[y][x] = { ...b[y][x], piece };
        }
      } else if (editorTool === "locked_mech") {
        if (
          e.type === "pointerdown" ||
          (e.type === "pointerenter" && e.buttons === 1)
        ) {
          // Can be placed on any element except duplicator, rotate, void, and neutral
          const forbiddenTypes = [
            "dup",
            "rot_cw",
            "rot_ccw",
            "void",
            "neutral",
          ];
          if (!forbiddenTypes.includes(b[y][x].type)) {
            b[y][x] = { ...b[y][x], mechanicalLock: !b[y][x].mechanicalLock };
          }
        }
      } else if (editorTool === "flip_toggle") {
        if (
          e.type === "pointerdown" ||
          (e.type === "pointerenter" && e.buttons === 1)
        ) {
          const forbiddenTypes = ["void", "neutral"];
          if (!forbiddenTypes.includes(b[y][x].type)) {
            b[y][x] = { ...b[y][x], flipMod: !b[y][x].flipMod };
          }
        }
      } else if (editorTool !== "wall") {
        const finalDir = ["dup", "zap", "mov"].includes(editorTool)
          ? lastMouseDir.current
          : editorDir;
        b[y][x] = {
          ...b[y][x],
          type: editorTool,
          dir: finalDir,
          letter: editorLetter,
        };
        if (editorTool === "empty" || editorTool === "void") {
          b[y][x].piece = null;
          b[y][x].mechanicalLock = false;
          b[y][x].flipMod = false;
          b[y][x].isTarget = false;
          b[y][x].walls = { r: false, b: false, bl: false, br: false };
        }
      }
      setBoard(b);
      return;
    }

    let target = board[y][x];
    if (target.type === "void") return;
    if (target.type === "locked_letter" && !target.unlocked) return;
    if (
      target.type === "locked_mech" ||
      target.mechanicalLock ||
      target.type === "dup" ||
      target.type === "neutral"
    )
      return;
    if (target.piece) return;

    if (
      currentPlayer !== "X" &&
      appMode !== "local" &&
      appMode !== "multiplayer" &&
      appMode !== "editor"
    ) {
      return;
    }

    resolveTurn(x, y);
  };

  const toggleWall = (x, y, edge) => {
    let b = [...board];
    b[y] = [...b[y]];
    // Orthogonal
    if (edge === "r") b[y][x].walls.r = !b[y][x].walls.r;
    if (edge === "b") b[y][x].walls.b = !b[y][x].walls.b;
    if (edge === "l" && x > 0)
      b[y][x - 1] = {
        ...b[y][x - 1],
        walls: { ...b[y][x - 1].walls, r: !b[y][x - 1].walls.r },
      };
    if (edge === "t" && y > 0)
      b[y - 1][x] = {
        ...b[y - 1][x],
        walls: { ...b[y - 1][x].walls, b: !b[y - 1][x].walls.b },
      };
    // Diagonal Corners
    if (edge === "tl" && y > 0 && x > 0)
      b[y - 1][x - 1] = {
        ...b[y - 1][x - 1],
        walls: { ...b[y - 1][x - 1].walls, br: !b[y - 1][x - 1].walls.br },
      };
    if (edge === "tr" && y > 0 && x < cols - 1)
      b[y - 1][x + 1] = {
        ...b[y - 1][x + 1],
        walls: { ...b[y - 1][x + 1].walls, bl: !b[y - 1][x + 1].walls.bl },
      };
    if (edge === "bl") b[y][x].walls.bl = !b[y][x].walls.bl;
    if (edge === "br") b[y][x].walls.br = !b[y][x].walls.br;

    setBoard(b);
  };

  // --- DATA MANAGEMENT ---
  const loadLevel = (levelData) => {
    setGameMode(levelData.gameMode || "standard");
    console.log("Loading level with data:", levelData);
    console.log(gameMode);
    setCols(levelData.cols || levelData.gridSize || 9);
    setRows(levelData.rows || levelData.gridSize || 9);
    setBoard(JSON.parse(JSON.stringify(levelData.board)));
    setCurrentGoals(
      levelData.goals ||
        (levelData.goal ? [levelData.goal] : [{ type: "standard", target: 0 }]),
    );
    setMovesMade(0);
    setMaxComboAchieved(0);
    setAiBehavior(levelData.aiBehavior || "standard");

    let d = levelData.dialogs || [];
    if (levelData.preLevelDialog && d.length === 0) {
      d = levelData.preLevelDialog
        .split("\n")
        .filter((l) => l.trim())
        .map((line) => {
          let s = line.indexOf(":");
          if (s > -1)
            return {
              name: line.slice(0, s).trim(),
              text: line.slice(s + 1).trim(),
            };
          return { name: "System", text: line.trim() };
        });
    }
    setDialogs(d);

    setScores({ X: 0, O: 0, T: 0, S: 0 });
    setDrawnLines([]);
    setExtraTurns(0);
    setCurrentPlayer("X");
    setActivePlayers(["X", "O"]);
    setGameOver(false);
    setWinMessage("");
    setPan({ x: 50, y: 50 }); // Reset Camera
    setZoom(1);
    setFailState(false);

    if (d.length > 0 && appMode !== "editor") {
      setDialogIndex(0);
      setShowDialog(true);
    }
  };

  const handleLevelImport = (e, callback) => {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = (ev) => {
      try {
        const d = JSON.parse(ev.target.result);
        callback(d);
      } catch (err) {
        alert("Invalid JSON");
      }
    };
    r.readAsText(file);
    e.target.value = null;
  };

  // --- RENDERERS ---
  if (appMode === "title") {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 selection:bg-cyan-500/30">
        <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-indigo-400 to-rose-400 mb-2 drop-shadow-[0_0_15px_rgba(56,189,248,0.4)]">
          TIC-TAC-TOE: EVOLVED
        </h1>
        <p className="text-slate-400 font-mono mb-12">
          The Ultimate Chain-Reaction Grid Engine
        </p>

        <div className="flex flex-col gap-4 w-full max-w-sm">
          <button
            onClick={() => setAppMode("local_setup")}
            className="p-4 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl border border-slate-700 transition-all hover:scale-105"
          >
            PLAY LOCAL PVP
          </button>
          <button
            onClick={() => setAppMode("multiplayer_setup")}
            className="p-4 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl border border-slate-700 transition-all hover:scale-105"
          >
            PLAY ONLINE
          </button>
          <button
            onClick={() => setAppMode("campaign_select")}
            className="p-4 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 font-bold rounded-xl border border-indigo-500/50 transition-all hover:scale-105"
          >
            PLAY CAMPAIGN
          </button>
          <button
            onClick={() => setAppMode("solo_setup")}
            className="p-4 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 font-bold rounded-xl border border-emerald-500/50 transition-all hover:scale-105"
          >
            PLAY SOLO
          </button>
          <button
            onClick={() => {
              setAppMode("editor");
              setBoard(createEmptyBoard(DEFAULT_COLS, DEFAULT_ROWS));
            }}
            className="p-4 bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 font-bold rounded-xl border border-amber-500/50 transition-all hover:scale-105"
          >
            LEVEL / CAMPAIGN EDITOR
          </button>
        </div>
      </div>
    );
  }

  // --- SETUP MENUS ---
  if (appMode === "local_setup" || appMode === "solo_setup") {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl max-w-md w-full shadow-2xl flex flex-col gap-6">
          <h2 className="text-2xl font-black text-white">
            {appMode === "local_setup" ? "LOCAL MATCH CONFIG" : "SOLO CONFIG"}
          </h2>

          <div>
            <label className="text-xs text-slate-400 font-bold block mb-1">
              {appMode === "local_setup" ? "PLAYERS" : "OPPONENTS (AI)"}
            </label>
            <select
              value={activePlayers.length}
              onChange={(e) => {
                const count = parseInt(e.target.value);
                setActivePlayers(["X", "O", "T", "S"].slice(0, count));
              }}
              className="w-full bg-slate-800 text-white p-2 rounded outline-none border border-slate-700"
            >
              <option value="2">
                {appMode === "local_setup"
                  ? "2 Players (X vs O)"
                  : "1 Bot (X vs O)"}
              </option>
              <option value="3">
                {appMode === "local_setup"
                  ? "3 Players (X, O, T)"
                  : "2 Bots (X vs O vs T)"}
              </option>
              <option value="4">
                {appMode === "local_setup"
                  ? "4 Players (X, O, T, S)"
                  : "3 Bots (X vs O vs T vs S)"}
              </option>
            </select>
          </div>

          {appMode === "solo_setup" && (
            <div>
              <label className="text-xs text-slate-400 font-bold block mb-1">
                AI DIFFICULTY
              </label>
              <select
                value={aiDiff}
                onChange={(e) => setAiDiff(e.target.value)}
                className="w-full bg-slate-800 text-white p-2 rounded outline-none border border-slate-700"
              >
                <option value="drunk">Drunk (100% Random)</option>
                <option value="easy">Easy (35% Random)</option>
                <option value="normal">Normal (15% Random)</option>
                <option value="hard">Hard (0% Random)</option>
              </select>
            </div>
          )}

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-xs text-slate-400 font-bold block mb-1">
                GRID WIDTH
              </label>
              <input
                type="number"
                min="1"
                max="30"
                value={cols}
                onChange={(e) =>
                  setCols(Math.max(1, parseInt(e.target.value) || 1))
                }
                className="w-full bg-slate-800 text-white p-2 rounded outline-none border border-slate-700"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-slate-400 font-bold block mb-1">
                GRID HEIGHT
              </label>
              <input
                type="number"
                min="1"
                max="30"
                value={rows}
                onChange={(e) =>
                  setRows(Math.max(1, parseInt(e.target.value) || 1))
                }
                className="w-full bg-slate-800 text-white p-2 rounded outline-none border border-slate-700"
              />
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-800"></div>
            </div>
            <div className="relative flex justify-center">
              <span className="bg-slate-900 px-2 text-xs text-slate-500 font-bold">
                OR
              </span>
            </div>
          </div>

          <div>
            <label className="w-full py-3 bg-slate-800 text-slate-300 rounded font-bold cursor-pointer text-center block hover:bg-slate-700 border border-slate-700">
              IMPORT LEVEL JSON
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) =>
                  handleLevelImport(e, (d) => {
                    console.log("Loaded level data:", d);
                    setGameMode(d.gameMode || "standard");
                    setCols(d.cols || d.gridSize || 9);
                    setRows(d.rows || d.gridSize || 9);
                    setBoard(JSON.parse(JSON.stringify(d.board)));
                    setCurrentGoals(
                      d.goals ||
                        (d.goal ? [d.goal] : [{ type: "standard", target: 0 }]),
                    );
                    setAiBehavior(d.aiBehavior || "standard");
                    console.log(gameMode);
                  })
                }
              />
            </label>
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={resetToTitle}
              className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded"
            >
              CANCEL
            </button>
            <button
              onClick={() => {
                if (!board || board.length !== rows || board[0].length !== cols)
                  setBoard(createEmptyBoard(cols, rows));
                setScores({ X: 0, O: 0, T: 0, S: 0 });
                setDrawnLines([]);
                setExtraTurns(0);
                setCurrentPlayer("X");
                setGameOver(false);
                setAppMode(appMode === "local_setup" ? "local" : "solo");
              }}
              className="flex-1 py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded"
            >
              START MATCH
            </button>
          </div>
        </div>
      </div>
    );
  }

  const getProceduralMove = (
    board,
    aiPiece,
    rows,
    cols,
    difficulty,
    aiBehavior,
    gameMode,
    activePlayers = ["X", "O"],
  ) => {
    let validMoves = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const cell = board[y][x];
        if (
          cell.type !== "rot_cw" &&
          cell.type !== "rot_ccw" &&
          cell.type !== "void" &&
          cell.type !== "locked_mech" &&
          !cell.mechanicalLock &&
          cell.type !== "dup" &&
          cell.type !== "neutral" &&
          cell.type !== "locked_letter" &&
          cell.type !== "trash" &&
          !cell.piece
        ) {
          validMoves.push({ x, y });
        }
      }
    }

    if (validMoves.length === 0) return null;
    if (gameMode === "pulse_blitz" && Math.random() < 0.2) return null;

    let bestMove = null;
    let highestUtility = -Infinity;
    const opponents = activePlayers.filter((p) => p !== aiPiece);

    const getGravityY = (startX, startY) => {
      let finalY = startY;
      const blockingTypes = [
        "void",
        "locked_mech",
        "locked_letter",
        "rot_cw",
        "rot_ccw",
        "dup",
        "neutral",
      ];
      while (finalY + 1 < rows) {
        let current = board[finalY][startX];
        let below = board[finalY + 1][startX];
        if (current.walls?.b) break;
        if (
          !below.piece &&
          !below.mechanicalLock &&
          !blockingTypes.includes(below.type)
        ) {
          finalY++;
        } else {
          break;
        }
      }
      return finalY;
    };

    validMoves.forEach((move) => {
      let utility = 0;
      let evaluatedPositions = [];

      let actualY =
        gameMode === "cascade" ? getGravityY(move.x, move.y) : move.y;
      evaluatedPositions.push({ x: move.x, y: actualY });

      if (gameMode === "mirror_protocol") {
        let mx = cols - 1 - move.x;
        if (mx >= 0 && mx < cols && mx !== move.x) {
          let mCell = board[move.y][mx];
          if (
            !mCell.piece &&
            !mCell.mechanicalLock &&
            mCell.type !== "void" &&
            mCell.type !== "locked_mech" &&
            mCell.type !== "locked_letter"
          ) {
            let actualMirrorY =
              gameMode === "cascade" ? getGravityY(mx, move.y) : move.y;
            evaluatedPositions.push({ x: mx, y: actualMirrorY });
          }
        }
      }

      // --- NEW: Predictive Chain Engine (The Menace Protocol) ---
      let finalPositions = [];

      // --- TACTICAL EVALUATION ---
      finalPositions.forEach((pos) => {
        const { x, y, isOverwrite } = pos;
        const targetCell = board[y][x];

        let actualPiece = aiPiece;
        if (targetCell.type === "flip" || targetCell.flipMod)
          actualPiece = opponents[0]; // Simplified flip logic for >2 bots
        else if (targetCell.type === "trash") actualPiece = null;

        // MENACE LOGIC: Weaponize overwrites
        if (isOverwrite) {
          if (opponents.includes(targetCell.piece))
            utility += 800; // Assassinate opponent
          else if (targetCell.piece === aiPiece) utility -= 500; // Avoid suicide
        }

        const centerDistX = Math.abs(x - Math.floor(cols / 2));
        const centerDistY = Math.abs(y - Math.floor(rows / 2));
        utility += (cols - centerDistX) * 2;
        utility += (rows - centerDistY) * 2;

        if (["rot_cw", "rot_ccw"].includes(targetCell.type)) utility += 15;

        if (targetCell.isTarget) {
          if (actualPiece === aiPiece) utility += 50;
          else if (opponents.includes(actualPiece)) utility -= 50;
        }

        if (actualPiece === null) {
          utility -= 50;
          return;
        }

        const checkLinePotential = (pieceToCheck) => {
          let score = 0;
          const dirs = [
            [1, 0],
            [0, 1],
            [1, 1],
            [1, -1],
          ];
          dirs.forEach(([dx, dy]) => {
            let count = 1;
            let openEnds = 0;

            let cx = x + dx,
              cy = y + dy;
            while (cx >= 0 && cx < cols && cy >= 0 && cy < rows) {
              if (board[cy][cx].piece === pieceToCheck) count++;
              else if (!board[cy][cx].piece && board[cy][cx].type !== "void") {
                openEnds++;
                break;
              } else break;
              cx += dx;
              cy += dy;
            }

            cx = x - dx;
            cy = y - dy;
            while (cx >= 0 && cx < cols && cy >= 0 && cy < rows) {
              if (board[cy][cx].piece === pieceToCheck) count++;
              else if (!board[cy][cx].piece && board[cy][cx].type !== "void") {
                openEnds++;
                break;
              } else break;
              cx -= dx;
              cy -= dy;
            }

            if (count >= 3) score += 10000;
            else if (count === 2 && openEnds > 0) score += 50;
          });
          return score;
        };

        if (actualPiece === aiPiece) {
          utility +=
            checkLinePotential(aiPiece) *
            (aiBehavior === "aggressive" ? 1.5 : 1);
          opponents.forEach((opp) => {
            utility +=
              checkLinePotential(opp) *
              (aiBehavior === "defensive" ? 1.5 : 1.2);
          });
        } else if (opponents.includes(actualPiece)) {
          utility -= checkLinePotential(actualPiece) * 2;
          utility -= 100;
        }
      });

      if (difficulty === "drunk") utility += Math.random() * 1000;
      else if (difficulty === "easy") utility += Math.random() * 200;
      else if (difficulty === "normal") utility += Math.random() * 40;

      if (utility > highestUtility) {
        highestUtility = utility;
        bestMove = move;
      }
    });

    return bestMove;
  };

  // --- MAIN GAME UI ---
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-cyan-500/30 flex flex-col h-screen overflow-hidden select-none">
      {/* DIALOG OVERLAY (Visual Novel Style) */}
      {showDialog && dialogs.length > 0 && (
        <div className="absolute inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-end justify-center pb-8 p-4 pointer-events-auto">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-2xl max-w-3xl w-full shadow-2xl flex flex-col gap-3 transition-all transform translate-y-0 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1.5 h-full bg-cyan-500"></div>
            <h2 className="text-xl font-black text-cyan-400 tracking-wider pl-2">
              {dialogs[dialogIndex].name}
            </h2>
            <p className="text-slate-200 whitespace-pre-wrap text-lg leading-relaxed pl-2 pb-6">
              {dialogs[dialogIndex].text}
            </p>

            <div className="flex justify-end mt-2 gap-4">
              <button
                onClick={skipDialog}
                className="px-8 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg transition-colors flex items-center gap-2 border border-slate-700"
              >
                {"Skip [>>]"}
              </button>
              <button
                onClick={() => {
                  if (dialogIndex < dialogs.length - 1)
                    setDialogIndex((d) => d + 1);
                  else setShowDialog(false);
                }}
                className="px-8 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg transition-colors flex items-center gap-2 border border-slate-700"
              >
                {dialogIndex < dialogs.length - 1 ? "NEXT ▶" : "START MATCH"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}

      <div className="w-full flex flex-wrap justify-between items-center p-4 border-b border-slate-800 bg-slate-900/50 z-10 shrink-0">
        {gameMode === "pulse_blitz" && (
          <div className="absolute top-0 left-0 w-full h-1 bg-slate-900 z-50">
            <div
              className="h-full bg-cyan-500 transition-all duration-100 linear"
              style={{ width: `${pulseTime}%` }}
            />
          </div>
        )}
        <div className="flex items-center gap-4">
          <button
            onClick={resetToTitle}
            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded text-slate-400 transition-colors"
          >
            &larr; BACK
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-white leading-none">
              TTT: EVOLVED
            </h1>
            <p className="text-indigo-400 text-[10px] sm:text-xs font-mono uppercase font-bold">
              {appMode === "campaign"
                ? `Campaign Level ${campaignIndex + 1}/${campaign.length}`
                : isPlaytesting
                  ? "PLAYTEST MODE"
                  : `${appMode} Mode`}
            </p>
          </div>
        </div>

        {appMode === "campaign_select" && (
          <div className="flex flex-col items-center justify-center h-screen space-y-6 relative z-10 w-full">
            <h2 className="text-4xl font-black text-white tracking-widest drop-shadow-[0_0_10px_rgba(255,255,255,0.8)]">
              SELECT CAMPAIGN
            </h2>

            <div className="bg-slate-900 border border-slate-800 rounded p-4 w-96 max-w-full">
              <label className="text-xs text-slate-400 font-bold block mb-2 tracking-widest uppercase">
                Global AI Difficulty
              </label>
              <select
                value={aiDiff}
                onChange={(e) => setAiDiff(e.target.value)}
                className="w-full bg-slate-800 text-cyan-400 font-bold p-2 rounded outline-none border border-slate-700"
              >
                <option value="drunk">Drunk (100% Random)</option>
                <option value="easy">Easy (35% Random)</option>
                <option value="normal">Normal (15% Random)</option>
                <option value="hard">Hard (0% Random)</option>
              </select>
            </div>

            <div className="flex flex-col space-y-3 w-96 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
              {savedCampaigns.map((camp) => (
                <div key={camp.id} className="group relative flex w-full">
                  <button
                    onClick={() => loadCampaign(camp.id)}
                    className="flex-grow py-4 bg-slate-800 text-white font-mono text-sm uppercase tracking-widest hover:bg-cyan-900/50 transition-colors border border-slate-600 flex justify-between px-4 text-left"
                  >
                    <span className="truncate pr-4">{camp.name}</span>
                    <span className="text-cyan-400 shrink-0">
                      {camp.levels?.length || 0} LVLs
                    </span>
                  </button>

                  {camp.id !== "default" && (
                    <button
                      onClick={(e) => deleteCampaign(camp.id, e)}
                      className="absolute right-0 h-full px-4 bg-rose-900/80 text-rose-300 border border-rose-700 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-700 font-bold"
                    >
                      X
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex space-x-4 mt-8">
              <label className="cursor-pointer px-6 py-3 bg-cyan-900/50 text-cyan-400 border border-cyan-500/50 font-mono text-sm hover:bg-cyan-800/50 transition-colors uppercase tracking-widest">
                Upload .JSON
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleCampaignUpload}
                />
              </label>

              <button
                onClick={() => setAppMode("title")}
                className="px-6 py-3 bg-slate-800 text-slate-400 font-mono text-sm hover:text-white transition-colors uppercase tracking-widest"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {appMode === "campaign" && (
          <select
            value={campaignIndex}
            onChange={(e) => {
              setCampaignIndex(Number(e.target.value));
              loadLevel(campaign[Number(e.target.value)]);
            }}
            className="bg-slate-800 text-white text-xs font-bold p-2 rounded border border-slate-700 outline-none"
          >
            {campaign.map((lvl, i) => (
              <option key={i} value={i}>
                {lvl.name || `Level ${i + 1}`}
              </option>
            ))}
          </select>
        )}

        <div className="flex gap-4 sm:gap-6 font-mono bg-slate-950 p-2 rounded-lg border border-slate-800">
          <div
            className={`flex items-center gap-2 ${currentPlayer === "X" ? "text-cyan-400" : "text-slate-500"}`}
          >
            <span className="text-xl font-black">X</span>
            <span className="text-xs">
              {appMode === "solo" || appMode === "campaign" ? "YOU" : "P1"}:{" "}
              <strong className="text-white text-base">{scores.X}</strong>
            </span>
          </div>
                   {" "}
          {(appMode === "local" ||
            appMode === "editor" ||
            ((appMode === "campaign" || appMode === "solo") &&
              currentGoals.some((g) => g.type === "standard"))) && (
            <div
              className={`flex items-center gap-2 ${currentPlayer === "O" ? "text-rose-400" : "text-slate-500"}`}
            >
              <span className="text-xl font-black">O</span>
              <span className="text-xs">
                P2: <strong className="text-white text-base">{scores.O}</strong>
              </span>
            </div>
          )}
        </div>
      </div>

      {appMode === "multiplayer_setup" && (
        <div className="flex flex-col items-center justify-center h-full space-y-8 relative z-10 w-full p-8 max-w-xl mx-auto">
          <h2 className="text-3xl font-black text-white tracking-widest">
            MULTIPLAYER LOBBY
          </h2>

          <div className="w-full bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl flex flex-col gap-8">
            {!lobbyCode && !isHost ? (
              <div className="flex flex-col gap-4">
                <button
                  onClick={startMultiplayerHost}
                  className="w-full py-4 bg-cyan-600 hover:bg-cyan-500 text-white font-black rounded-xl text-xl tracking-wider transition-all shadow-[0_0_15px_rgba(8,145,178,0.5)]"
                >
                  CREATE LOBBY
                </button>

                {/* NEW: Upload Level Button */}
                <label className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl border border-slate-700 text-center cursor-pointer transition-all text-sm uppercase tracking-widest">
                  📂 Load Custom Level First
                  <input
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={(e) =>
                      handleLevelImport(e, (d) => {
                        setBoard(d.board);
                        setCols(d.cols || d.gridSize);
                        setRows(d.rows || d.gridSize);
                        setGameMode(d.gameMode || "standard");
                        setCurrentGoals(d.goals || [d.goal]);
                        alert("Level Loaded! Now create a lobby to play it.");
                      })
                    }
                  />
                </label>

                <div className="relative flex items-center justify-center my-4">
                  <div className="border-t border-slate-800 w-full"></div>
                  <span className="bg-slate-900 px-4 text-xs font-bold text-slate-500 absolute tracking-widest">
                    OR JOIN LOBBY
                  </span>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="CODE"
                    maxLength={4}
                    value={joinCodeInput}
                    onChange={(e) =>
                      setJoinCodeInput(e.target.value.toUpperCase())
                    }
                    className="flex-1 bg-slate-800 text-white font-black text-center text-xl p-4 rounded-xl border border-slate-700 outline-none uppercase"
                  />
                  <button
                    onClick={() => joinMultiplayerGame(joinCodeInput)}
                    className="px-8 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl transition-all"
                  >
                    JOIN
                  </button>
                </div>
              </div>
            ) : (
              /* WAITING ROOM */
              <div className="flex flex-col items-center text-center gap-6">
                <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">
                  {isHost ? "Your Lobby Code" : "Joining Lobby"}
                </p>
                <div className="text-6xl font-black text-cyan-400 tracking-widest bg-slate-950 py-4 px-12 rounded-2xl border border-cyan-900/50 shadow-[inset_0_0_20px_rgba(8,145,178,0.2)]">
                  {lobbyCode}
                </div>
                <p className="text-amber-400 animate-pulse font-bold mt-4">
                  {isHost ? "Waiting for player 2..." : "Connecting..."}
                </p>
                <button
                  onClick={() => {
                    setLobbyCode("");
                    setIsHost(false);
                    setIsMultiplayer(false);
                    setConnectionStatus("disconnected");
                    resetToTitle();
                  }}
                  className="text-xs text-slate-500 hover:text-rose-400 font-bold mt-4 transition-colors"
                >
                  CANCEL & LEAVE
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden relative">
        {/* SIDEBAR */}
        <div className="w-64 sm:w-72 bg-slate-900/90 border-r border-slate-800 p-4 flex flex-col gap-4 overflow-y-auto z-10 shrink-0 shadow-xl">
          {appMode === "editor" && !isPlaytesting ? (
            <div className="flex h-full flex-col gap-4">
              <div className="flex gap-1 border-b border-slate-800 pb-2">
                <button
                  onClick={() => setEditorTab("tools")}
                  className={`flex-1 text-[10px] font-bold py-1.5 rounded ${editorTab === "tools" ? "bg-indigo-600 text-white" : "text-slate-400 hover:bg-slate-800"}`}
                >
                  TOOLS
                </button>
                <button
                  onClick={() => setEditorTab("settings")}
                  className={`flex-1 text-[10px] font-bold py-1.5 rounded ${editorTab === "settings" ? "bg-indigo-600 text-white" : "text-slate-400 hover:bg-slate-800"}`}
                >
                  MAP
                </button>
                <button
                  onClick={() => setEditorTab("dialog")}
                  className={`flex-1 text-[10px] font-bold py-1.5 rounded ${editorTab === "dialog" ? "bg-indigo-600 text-white" : "text-slate-400 hover:bg-slate-800"}`}
                >
                  DIALOG
                </button>
                <button
                  onClick={() => setEditorTab("campaign")}
                  className={`flex-1 text-[10px] font-bold py-1.5 rounded ${editorTab === "campaign" ? "bg-indigo-600 text-white" : "text-slate-400 hover:bg-slate-800"}`}
                >
                  CAMP.
                </button>
              </div>

              {editorTab === "tools" && (
                <>
                  <div className="grid grid-cols-2 gap-1.5 mb-2">
                    <button
                      onClick={() => {
                        setBackupState({
                          board: JSON.parse(JSON.stringify(board)),
                          scores: { ...scores },
                          drawnLines: [...drawnLines],
                          extraTurns,
                          currentPlayer,
                          gameOver,
                        });
                        setScores({ X: 0, O: 0, T: 0, S: 0 });
                        setDrawnLines([]);
                        setExtraTurns(0);
                        setCurrentPlayer("X");
                        setGameOver(false);
                        setIsPlaytesting(true);
                        setPlaytestMode("standard");
                      }}
                      className="w-full py-2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 hover:bg-emerald-500/30 font-bold rounded text-xs tracking-wider"
                    >
                      ▶ TEST SOLO
                    </button>
                    <button
                      onClick={() => {
                        setBackupState({
                          board: JSON.parse(JSON.stringify(board)),
                          scores: { ...scores },
                          drawnLines: [...drawnLines],
                          extraTurns,
                          currentPlayer,
                          gameOver,
                        });
                        setScores({ X: 0, O: 0, T: 0, S: 0 });
                        setDrawnLines([]);
                        setExtraTurns(0);
                        setCurrentPlayer("X");
                        setGameOver(false);
                        setIsPlaytesting(true);
                        setPlaytestMode("manual");
                      }}
                      className="w-full py-2 bg-blue-500/20 text-blue-400 border border-blue-500/50 hover:bg-blue-500/30 font-bold rounded text-xs tracking-wider"
                    >
                      ▶ TEST P1VP2
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    {["empty", "void", "wall"].map((t) => (
                      <button
                        key={t}
                        onClick={() => setEditorTool(t)}
                        className={`p-1.5 rounded border text-[10px] uppercase font-bold ${editorTool === t ? "bg-indigo-500/30 border-indigo-400 text-indigo-200" : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700"}`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>

                  <label className="text-[10px] text-slate-500 font-bold uppercase mt-2 block">
                    Pieces
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {["place_x", "place_o", "place_t", "place_s"].map((t) => (
                      <button
                        key={t}
                        onClick={() => setEditorTool(t)}
                        className={`p-1.5 rounded border text-[10px] uppercase font-bold ${editorTool === t ? "bg-green-500/30 border-green-400 text-green-200" : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700"}`}
                      >
                        {t.replace("_", " ")}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {["neutral", "trash", "switch"].map((t) => (
                      <button
                        key={t}
                        onClick={() => setEditorTool(t)}
                        className={`p-1.5 rounded border text-[10px] uppercase font-bold ${editorTool === t ? "bg-indigo-500/30 border-indigo-400 text-indigo-200" : "bg-slate-800 border-slate-700 text-slate-400"}`}
                      >
                        {t}
                      </button>
                    ))}
                    {[
                      "locked_letter",
                      "locked_mech",
                      "target_toggle",
                      "flip_toggle",
                    ].map((t) => (
                      <button
                        key={t}
                        onClick={() => setEditorTool(t)}
                        className={`p-1.5 rounded border text-[10px] uppercase font-bold ${editorTool === t ? "bg-amber-500/30 border-amber-400 text-amber-200" : "bg-slate-800 border-slate-700 text-slate-400"}`}
                      >
                        {t === "locked_letter"
                          ? "Lock Ltr"
                          : t === "locked_mech"
                            ? "Lock Dot"
                            : t === "target_toggle"
                              ? "Target"
                              : "Flip Mod"}
                      </button>
                    ))}
                  </div>

                  {["switch", "locked_letter"].includes(editorTool) && (
                    <div className="flex justify-between mt-1 gap-1">
                      {["A", "B", "C", "D"].map((l) => (
                        <button
                          key={l}
                          onClick={() => setEditorLetter(l)}
                          className={`flex-1 p-1 rounded border text-xs font-bold ${editorLetter === l ? "bg-amber-500/30 border-amber-400 text-amber-200" : "bg-slate-800 border-slate-700 text-slate-400"}`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  )}

                  <label className="text-[10px] text-slate-500 font-bold uppercase mt-2 block">
                    Entities
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {["dup", "zap", "mov", "rot_cw", "rot_ccw"].map((t) => (
                      <button
                        key={t}
                        onClick={() => setEditorTool(t)}
                        className={`p-1.5 rounded border text-[10px] uppercase font-bold ${editorTool === t ? "bg-indigo-500/30 border-indigo-400 text-indigo-200" : "bg-slate-800 border-slate-700 text-slate-400"}`}
                      >
                        {t.replace("_", " ")}
                      </button>
                    ))}
                  </div>

                  <div className="text-[10px] text-slate-400 mt-2 p-2 bg-slate-950 rounded leading-relaxed border border-slate-800">
                    <p>
                      <strong>Brush:</strong> Drag mouse across tiles to paint.
                      Entities will face your drag direction!
                    </p>
                    <p>
                      <strong>Walls:</strong> Click Edges for orthogonal walls.
                      Click Corners for diagonal blocks.
                    </p>
                    <p>
                      <strong>Pieces:</strong> Place predefined X and O pieces
                      for puzzle setups.
                    </p>
                    <p>
                      <strong>Lock Dot:</strong> Toggle mechanical locks as
                      overlays on most cell types.
                    </p>
                    <p>
                      <strong>Campaign:</strong> Click levels to edit,
                      double-click to rename, drag to reorder, use Save to
                      update selected level.
                    </p>
                  </div>
                </>
              )}

              {editorTab === "settings" && (
                <div className="flex flex-col h-full gap-3">
                  <div className="p-3 bg-slate-950 rounded border border-slate-800 flex flex-col gap-2">
                    <label className="text-[10px] text-slate-500 font-bold uppercase">
                      Players
                    </label>
                    <select
                      value={activePlayers.length}
                      onChange={(e) => {
                        const count = parseInt(e.target.value);
                        setActivePlayers(["X", "O", "T", "S"].slice(0, count));
                      }}
                      className="w-full bg-slate-800 text-white p-1.5 rounded border border-slate-700 text-xs outline-none"
                    >
                      <option value="2">2 Players (X, O)</option>
                      <option value="3">3 Players (X, O, T)</option>
                      <option value="4">4 Players (X, O, T, S)</option>
                    </select>
                  </div>
                  <div className="p-3 bg-slate-950 rounded border border-slate-800 flex flex-col gap-2">
                    <label className="text-[10px] text-slate-500 font-bold uppercase">
                      Game Mode
                    </label>
                    <select
                      value={gameMode}
                      onChange={(e) => setGameMode(e.target.value)}
                      className="w-full bg-slate-800 text-white p-1.5 rounded border border-slate-700 text-xs outline-none"
                    >
                      <option value="standard">Standard</option>
                      <option value="zone_control">Zone Control</option>
                      <option value="corruption">The Corruption</option>
                      <option value="turf_wars">Turf Wars</option>
                      <option value="pulse_blitz">Pulse Blitz</option>
                      <option value="cascade">Cascade</option>
                      <option value="mirror_protocol">Mirror Protocol</option>
                    </select>
                  </div>
                  <div className="p-3 bg-slate-950 rounded border border-slate-800 flex flex-col gap-2">
                    <label className="text-[10px] text-slate-500 font-bold uppercase">
                      Dimensions
                    </label>
                                       {" "}
                    <div className="flex gap-2">
                                           {" "}
                      <div className="flex-1">
                                               {" "}
                        <span className="text-xs text-slate-400 mb-1 block">
                          Width (X)
                        </span>
                                               {" "}
                        <input
                          type="number"
                          min="1"
                          max="30"
                          value={cols}
                          onChange={(e) => {
                            let v = parseInt(e.target.value) || 1;
                            setCols(v);
                            setBoard(createEmptyBoard(v, rows));
                          }}
                          className="w-full bg-slate-800 text-white p-1 rounded border border-slate-700 text-sm outline-none"
                        />
                                             {" "}
                      </div>
                                           {" "}
                      <div className="flex-1">
                                               {" "}
                        <span className="text-xs text-slate-400 mb-1 block">
                          Height (Y)
                        </span>
                                               {" "}
                        <input
                          type="number"
                          min="1"
                          max="30"
                          value={rows}
                          onChange={(e) => {
                            let v = parseInt(e.target.value) || 1;
                            setRows(v);
                            setBoard(createEmptyBoard(cols, v));
                          }}
                          className="w-full bg-slate-800 text-white p-1 rounded border border-slate-700 text-sm outline-none"
                        />
                                             {" "}
                      </div>
                                         {" "}
                    </div>
                                       {" "}
                    <button
                      onClick={() => setBoard(createEmptyBoard(cols, rows))}
                      className="mt-2 w-full py-1.5 bg-rose-500/20 text-rose-400 rounded border border-rose-500/30 text-[10px] font-bold uppercase tracking-wider"
                    >
                      Clear Board
                    </button>
                                     {" "}
                  </div>
                                                      {" "}
                  <div className="p-3 h-full bg-slate-950 rounded border border-slate-800 flex flex-col gap-2">
                                         
                    <label className="text-[10px] text-slate-500 font-bold uppercase block">
                      Level Goals
                    </label>
                                         
                    <div className="overflow-y-auto h-full space-y-2 pr-1 custom-scrollbar">
                                             {" "}
                      {currentGoals.map((g, i) => (
                        <div
                          key={i}
                          className="bg-slate-900 p-2 rounded border border-slate-700 relative flex flex-col gap-1.5"
                        >
                                                       {" "}
                          <div className="flex justify-between items-center gap-2">
                                                           {" "}
                            <select
                              value={g.type}
                              onChange={(e) => {
                                let ng = [...currentGoals];
                                ng[i].type = e.target.value;
                                setCurrentGoals(ng);
                              }}
                              className="flex-1 bg-slate-800 text-white text-[10px] p-1.5 rounded border border-slate-600 outline-none"
                            >
                                                                 
                              <option value="standard">Standard (vs AI)</option>
                                                                 
                              <option value="exact_score">Exact Score</option> 
                                                               
                              <option value="min_score">Minimum Score</option> 
                                                               
                              <option value="max_score">Maximum Score</option> 
                                                               
                              <option value="fill_targets">Fill Targets</option>
                                                                 
                              <option value="min_combo">Minimum Combo</option> 
                                                               
                              <option value="max_moves">Maximum Moves</option> 
                                                                               
                                             {" "}
                            </select>
                                                           {" "}
                            <button
                              onClick={() =>
                                setCurrentGoals(
                                  currentGoals.filter((_, idx) => idx !== i),
                                )
                              }
                              className="text-rose-500 hover:text-rose-400 font-black px-2"
                            >
                              X
                            </button>
                                                         {" "}
                          </div>
                                                       {" "}
                          {g.type !== "fill_targets" &&
                            g.type !== "clear_all" && (
                              <div className="flex flex-col gap-1 w-full">
                                                                   
                                {g.type !== "standard" && (
                                  <input
                                    type="number"
                                    value={g.target}
                                    onChange={(e) => {
                                      let ng = [...currentGoals];
                                      ng[i].target = Number(e.target.value);
                                      setCurrentGoals(ng);
                                    }}
                                    className="flex-1 bg-slate-800 text-white p-1.5 text-[10px] rounded border border-slate-600 outline-none"
                                    placeholder="Target Value"
                                  />
                                )}
                                                                   
                                {g.type === "max_moves" && (
                                  <select
                                    value={g.mode || "fail"}
                                    onChange={(e) => {
                                      let ng = [...currentGoals];
                                      ng[i].mode = e.target.value;
                                      setCurrentGoals(ng);
                                    }}
                                    className="w-full bg-slate-800 text-white text-[10px] p-1.5 rounded border border-slate-600 outline-none"
                                  >
                                                                           
                                    <option value="fail">Fail on Limit</option> 
                                                                         
                                    <option value="end">Early End</option>     
                                                                   
                                  </select>
                                )}
                                {g.type === "standard" && (
                                  <select
                                    value={aiBehavior}
                                    onChange={(e) =>
                                      setAiBehavior(e.target.value)
                                    }
                                    className="w-full bg-slate-800 text-white text-[10px] p-1.5 rounded border border-slate-600 outline-none"
                                  >
                                                                     
                                    <option value="standard">
                                      Standard (Balanced)
                                    </option>
                                                                     
                                    <option value="aggressive">
                                      Aggressive (Attack)
                                    </option>
                                                                     
                                    <option value="defensive">
                                      Defensive (Stop Player)
                                    </option>
                                                                 
                                  </select>
                                )}
                                                                 
                              </div>
                            )}
                                                     
                        </div>
                      ))}
                                           
                    </div>
                                         
                    <button
                      onClick={() =>
                        setCurrentGoals([
                          ...currentGoals,
                          { type: "standard", target: 0 },
                        ])
                      }
                      className="w-full py-1.5 bg-indigo-500/20 text-indigo-300 rounded text-[10px] font-bold border border-indigo-500/50 hover:bg-indigo-500/40 mt-1"
                    >
                                              + ADD GOAL                      
                    </button>
                                     {" "}
                  </div>
                                 {" "}
                </div>
              )}

              {editorTab === "dialog" && (
                <div className="flex flex-col gap-3">
                  <div className="overflow-y-auto space-y-2 pr-1">
                    {dialogs.map((d, i) => (
                      <div
                        key={i}
                        className="bg-slate-950 p-2 rounded border border-slate-800 flex flex-col gap-1.5"
                      >
                        <div className="flex justify-between items-center gap-2">
                          <input
                            value={d.name}
                            onChange={(e) => {
                              let nd = [...dialogs];
                              nd[i].name = e.target.value;
                              setDialogs(nd);
                            }}
                            className="bg-slate-800 text-cyan-400 font-bold p-1 text-xs w-2/3 outline-none rounded border border-slate-700"
                            placeholder="Character Name"
                          />
                          <button
                            onClick={() =>
                              setDialogs(dialogs.filter((_, idx) => idx !== i))
                            }
                            className="text-rose-500 hover:text-rose-400 font-black px-2"
                          >
                            X
                          </button>
                        </div>
                        <textarea
                          value={d.text}
                          onChange={(e) => {
                            let nd = [...dialogs];
                            nd[i].text = e.target.value;
                            setDialogs(nd);
                          }}
                          className="bg-slate-800 text-white p-1.5 text-xs outline-none rounded border border-slate-700 resize-none"
                          rows="3"
                          placeholder="Dialogue text..."
                        ></textarea>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() =>
                      setDialogs([...dialogs, { name: "System", text: "" }])
                    }
                    className="w-full py-2 bg-indigo-500/20 text-indigo-300 rounded text-[10px] font-bold border border-indigo-500/50 hover:bg-indigo-500/40"
                  >
                    + ADD DIALOG LINE
                  </button>
                </div>
              )}

              {editorTab === "campaign" && (
                <div className="flex flex-col gap-3 flex-1 h-full">
                                   {" "}
                  <input
                    id="campaign-name-input"
                    type="text"
                    defaultValue="My Campaign"
                    placeholder="Campaign Name"
                    className="w-full py-1.5 px-2 mb-1 bg-slate-900 border border-slate-700 rounded text-xs text-slate-200 outline-none focus:border-indigo-500"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        const newLevel = {
                          name: `Level ${campaign.length + 1}`,
                          gameMode: "standard",
                          cols: 9,
                          rows: 9,
                          board: createEmptyBoard(9, 9),
                          dialogs: [],
                          goals: [],
                          aiBehavior: "random",
                        };
                        setCampaign([...campaign, newLevel]);
                        setSelectedLevelIndex(campaign.length);
                        loadLevel(newLevel);
                      }}
                      className="flex-1 py-2 bg-indigo-500/20 text-indigo-300 rounded text-[10px] font-bold border border-indigo-500/50 hover:bg-indigo-500/40"
                    >
                      + NEW LEVEL
                    </button>
                    <button
                      onClick={() => {
                        const levelData = {
                          name:
                            campaign[selectedLevelIndex]?.name ||
                            `Level ${campaign.length + 1}`,
                          gameMode,
                          cols,
                          rows,
                          board,
                          dialogs,
                          goals: currentGoals,
                          aiBehavior,
                          activePlayers,
                        };

                        if (
                          selectedLevelIndex >= 0 &&
                          selectedLevelIndex < campaign.length
                        ) {
                          // Update existing
                          const newCampaign = [...campaign];
                          newCampaign[selectedLevelIndex] = levelData;
                          setCampaign(newCampaign);
                        } else {
                          // Add as new first level/append
                          setCampaign([...campaign, levelData]);
                          setSelectedLevelIndex(campaign.length);
                        }
                      }}
                      className="flex-1 py-2 bg-emerald-500/20 text-emerald-400 rounded text-[10px] font-bold border border-emerald-500/50 hover:bg-emerald-500/40"
                    >
                      {selectedLevelIndex >= 0
                        ? `SAVE LEVEL ${selectedLevelIndex + 1}`
                        : "SAVE AS NEW LEVEL"}
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-1.5 bg-slate-950 p-2 rounded border border-slate-800 min-h-[100px]">
                    {campaign.map((lvl, i) => (
                      <div
                        key={i}
                        draggable={renamingIndex !== i}
                        onDragStart={(e) =>
                          renamingIndex !== i && handleDragStart(e, i)
                        }
                        onDragOver={(e) =>
                          renamingIndex !== i && handleDragOver(e)
                        }
                        onDrop={(e) => renamingIndex !== i && handleDrop(e, i)}
                        className={`flex justify-between items-center p-1.5 rounded text-xs border cursor-pointer transition-colors ${
                          selectedLevelIndex === i
                            ? "bg-indigo-900/50 border-indigo-500 text-indigo-200"
                            : draggedIndex === i
                              ? "bg-slate-700 border-slate-600"
                              : "bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-300"
                        }`}
                        onClick={() => {
                          if (renamingIndex === i) return; // Don't select when renaming
                          setSelectedLevelIndex(i);
                          loadLevel(lvl);
                        }}
                        onDoubleClick={() => setRenamingIndex(i)}
                      >
                        {renamingIndex === i ? (
                          <input
                            autoFocus
                            defaultValue={lvl.name || `Level ${i + 1}`}
                            onBlur={(e) => {
                              const newName = e.target.value.trim();
                              if (newName) {
                                const newCampaign = [...campaign];
                                newCampaign[i] = {
                                  ...newCampaign[i],
                                  name: newName,
                                };
                                setCampaign(newCampaign);
                              }
                              setRenamingIndex(-1);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.target.blur();
                              } else if (e.key === "Escape") {
                                setRenamingIndex(-1);
                              }
                            }}
                            className="bg-slate-800 text-slate-200 text-xs px-1 py-0.5 rounded border border-slate-600 outline-none flex-1 mr-2"
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span className="font-bold flex-1">
                            {lvl.name || `Level ${i + 1}`}{" "}
                            <span className="text-slate-500 text-[10px]">
                              ({lvl.cols}x{lvl.rows})
                            </span>
                          </span>
                        )}
                        {renamingIndex !== i && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setCampaign(
                                campaign.filter((_, idx) => idx !== i),
                              );
                              if (selectedLevelIndex === i)
                                setSelectedLevelIndex(-1);
                              else if (selectedLevelIndex > i)
                                setSelectedLevelIndex(selectedLevelIndex - 1);
                              if (renamingIndex === i) setRenamingIndex(-1);
                            }}
                            className="text-rose-500 hover:text-rose-400 font-black px-2"
                          >
                            X
                          </button>
                        )}
                      </div>
                    ))}
                    {campaign.length === 0 && (
                      <p className="text-[10px] text-slate-600 text-center py-4">
                        Campaign Empty
                      </p>
                    )}
                  </div>
                                   {" "}
                  <div className="flex flex-col gap-2 mt-auto">
                                         
                    <button
                      onClick={() => {
                        const cName =
                          document
                            .getElementById("campaign-name-input")
                            ?.value.trim() || "campaign";
                        downloadJSON(campaign, `${cName}.json`);
                      }}
                      disabled={!campaign.length}
                      className="w-full py-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded text-[10px] font-bold disabled:opacity-50"
                    >
                      EXPORT CAMPAIGN (.JSON)
                    </button>
                                         
                    <button
                      onClick={() =>
                        downloadJSON(
                          {
                            gameMode,
                            cols,
                            rows,
                            board,
                            dialogs,
                            goals: currentGoals,
                            aiBehavior,
                          },
                          "level.json",
                        )
                      }
                      className="w-full py-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded text-[10px] font-bold"
                    >
                      EXPORT LEVEL (.JSON)
                    </button>
                    <label className="w-full py-1.5 bg-slate-800 text-slate-300 border border-slate-700 rounded text-[10px] font-bold cursor-pointer text-center block hover:bg-slate-700">
                      IMPORT LEVEL / CAMPAIGN
                      <input
                        type="file"
                        accept=".json"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files[0];
                          if (file) {
                            const nameWithoutExt = file.name.replace(
                              /\.json$/i,
                              "",
                            );
                            const input = document.getElementById(
                              "campaign-name-input",
                            );
                            if (input) input.value = nameWithoutExt;
                          }
                          handleLevelImport(e, (d) => {
                            if (Array.isArray(d)) setCampaign(d);
                            else loadLevel(d);
                          });
                        }}
                      />
                    </label>
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            "Start a new campaign? Unsaved progress will be lost.",
                          )
                        ) {
                          setCampaign([]);
                          setSelectedLevelIndex(-1);
                          localStorage.removeItem("ttt2_campaign_autosave");
                          const input = document.getElementById(
                            "campaign-name-input",
                          );
                          if (input) input.value = "My Campaign";
                        }
                      }}
                      className="w-full py-1.5 bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded text-[10px] font-bold hover:bg-rose-500/30"
                    >
                      NEW CAMPAIGN
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {isPlaytesting && (
                <button
                  onClick={() => {
                    setBoard(backupState.board);
                    setScores(backupState.scores);
                    setDrawnLines(backupState.drawnLines);
                    setExtraTurns(backupState.extraTurns);
                    setCurrentPlayer(backupState.currentPlayer);
                    setGameOver(backupState.gameOver);
                    setIsPlaytesting(false);
                  }}
                  className="w-full py-3 bg-rose-600 hover:bg-rose-500 text-white rounded text-sm font-bold shadow-lg flex justify-center items-center gap-2 border border-rose-400"
                >
                  ⏹ STOP PLAYTEST
                </button>
              )}
              {gameOver ? (
                <div className="text-center p-4 bg-slate-950 rounded-xl border border-slate-800 shadow-xl">
                  <h2
                    className={`text-xl font-black mb-2 ${failState ? "text-rose-400" : "text-white"}`}
                  >
                    {failState
                      ? "LEVEL FAILED"
                      : appMode === "campaign"
                        ? "LEVEL COMPLETE"
                        : "MATCH OVER"}
                  </h2>
                  <p
                    className={`text-sm mb-4 font-bold ${failState ? "text-rose-400" : "text-amber-400"}`}
                  >
                    {winMessage}
                  </p>
                  {failState ? (
                    <button
                      onClick={() => {
                        loadLevel(campaign[campaignIndex]);
                        setFailState(false);
                      }}
                      className="w-full py-2 bg-rose-600 hover:bg-rose-500 text-white rounded text-sm font-bold animate-pulse border border-rose-400"
                    >
                      RESTART LEVEL
                    </button>
                  ) : appMode === "campaign" &&
                    campaignIndex < campaign.length - 1 ? (
                    <button
                      onClick={() => {
                        setCampaignIndex(campaignIndex + 1);
                        loadLevel(campaign[campaignIndex + 1]);
                        setUnlockedLevels((u) =>
                          u.includes(campaignIndex + 1)
                            ? u
                            : [...u, campaignIndex + 1],
                        );
                      }}
                      className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold"
                    >
                      NEXT LEVEL &rarr;
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        if (appMode === "campaign") {
                          setCampaignIndex(0);
                          loadLevel(campaign[0]);
                        } else if (isPlaytesting) {
                        } // do nothing, handled by stop button
                        else {
                          setBoard(createEmptyBoard(cols, rows));
                          setScores({ X: 0, O: 0 });
                          setDrawnLines([]);
                          setGameOver(false);
                          setPan({ x: 50, y: 50 });
                          setZoom(1);
                        }
                      }}
                      className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-sm font-bold"
                      disabled={isPlaytesting}
                    >
                      {isPlaytesting ? "USE STOP BUTTON" : "PLAY AGAIN"}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="text-center p-4 bg-slate-950 rounded-xl border border-slate-800 shadow-xl relative overflow-hidden">
                    <p className="text-[10px] text-slate-500 font-bold tracking-widest uppercase mb-1">
                      Turn
                    </p>
                    <div
                      className={`text-6xl font-black transition-colors ${currentPlayer === "X" ? "text-cyan-400" : currentPlayer === "O" ? "text-rose-400" : currentPlayer === "T" ? "text-emerald-400" : "text-amber-400"} drop-shadow-md`}
                    >
                      {currentPlayer}
                    </div>
                    {extraTurns > 0 && (
                      <div className="mt-3 inline-block px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded-full text-xs font-bold border border-emerald-500/30 animate-pulse">
                        + {extraTurns} EXTRA TURN{extraTurns > 1 ? "S" : ""}
                      </div>
                    )}
                  </div>
                                     
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex flex-col gap-2">
                                         {" "}
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest flex justify-between">
                                              <span>Active Goals</span>         
                                   {" "}
                      {currentGoals.some((g) => g.type === "max_moves") && (
                        <span className="text-rose-400">
                          Moves: {movesMade}/
                          {
                            currentGoals.find((g) => g.type === "max_moves")
                              .target
                          }
                        </span>
                      )}
                                           {" "}
                    </p>
                                         {" "}
                    <div className="text-sm font-bold text-indigo-300 flex flex-col gap-1">
                                               
                      {currentGoals.map((g, i) => (
                        <div key={i} className="flex items-center gap-2">
                                                       
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                                                       
                          <span>
                                                           
                            {g.type === "standard" &&
                              "Score the most lines against AI."}
                                                           
                            {g.type === "exact_score" &&
                              `Get exactly ${g.target} points.`}
                                                           
                            {g.type === "min_score" &&
                              `Get at least ${g.target} points.`}
                                                           
                            {g.type === "max_score" &&
                              `Stay under ${g.target} points.`}
                                                           
                            {g.type === "fill_targets" &&
                              "Fill all Target spaces."}
                                                           
                            {g.type === "min_combo" &&
                              `Combo of ${g.target} (${Math.max(maxComboAchieved, 0)}/${g.target}).`}
                                                           
                            {g.type === "max_moves" &&
                              (!g.mode || g.mode === "fail"
                                ? `Win in ${g.target} moves or less.`
                                : `Game ends after ${g.target} moves.`)}
                                                         
                          </span>
                                                     
                        </div>
                      ))}
                                           {" "}
                    </div>
                                       
                  </div>
                  <div className="text-[10px] sm:text-xs text-slate-400 space-y-2 bg-slate-950 p-4 rounded-xl border border-slate-800 mt-auto">
                    <p>
                      <strong className="text-white text-[10px] uppercase block mb-0.5">
                        Navigation
                      </strong>
                      Space+Drag, Middle-Click, or Arrow Keys to Pan. Scroll to
                      Zoom.
                    </p>
                    <div className="w-full h-px bg-slate-800 my-2"></div>
                    <p>
                      <strong className="text-white">&gt; 3 Rule:</strong> Lines
                      &gt;3 grant{" "}
                      <code className="text-amber-400 bg-slate-900 px-1 rounded">
                        L-3
                      </code>{" "}
                      extra turns!
                    </p>
                    <p>
                      <strong className="text-white">Multi-Points:</strong>{" "}
                      Scoring multiple independent lines at once grants{" "}
                      <code className="text-amber-400 bg-slate-900 px-1 rounded">
                        +1
                      </code>{" "}
                      turn per extra line!
                    </p>
                    <p>
                      <strong className="text-white">Line Break:</strong> Duping
                      onto a dead piece breaks the old line, revives its pieces,
                      and steals a point.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* FIGMA CANVAS AREA */}
        <div
          className={`flex-1 overflow-hidden bg-[#0f172a] relative transition-cursor ${isDragging.current ? "cursor-grabbing" : isSpaceHeld ? "cursor-grab" : "cursor-crosshair"}`}
          style={{
            backgroundImage: "radial-gradient(#334155 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          ref={canvasRef}
        >
          {/* Zoom & Pan Container */}
          <div
            className="absolute"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
              width: `${cols * 60}px`,
              height: `${rows * 60}px`,
            }}
          >
            <div
              className="w-full h-full grid relative shadow-2xl shadow-black/80 bg-slate-900 border border-slate-800"
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
              }}
            >
              {/* SVG OVERLAY (Lines & Walls) */}
              <svg
                className="absolute top-0 left-0 w-full h-full pointer-events-none z-30"
                style={{ overflow: "visible" }}
              >
                {board.map((row, y) =>
                  row.map((cell, x) => (
                    <React.Fragment key={`wall-${x}-${y}`}>
                      {/* Orthogonal Walls */}
                      {cell.walls.r && (
                        <line
                          x1={`${((x + 1) * 100) / cols}%`}
                          y1={`${(y * 100) / rows}%`}
                          x2={`${((x + 1) * 100) / cols}%`}
                          y2={`${((y + 1) * 100) / rows}%`}
                          stroke="#94a3b8"
                          strokeWidth="4"
                          strokeLinecap="round"
                        />
                      )}
                      {cell.walls.b && (
                        <line
                          x1={`${(x * 100) / cols}%`}
                          y1={`${((y + 1) * 100) / rows}%`}
                          x2={`${((x + 1) * 100) / cols}%`}
                          y2={`${((y + 1) * 100) / rows}%`}
                          stroke="#94a3b8"
                          strokeWidth="4"
                          strokeLinecap="round"
                        />
                      )}

                      {/* Corner Diagonal Walls (Intersecting precisely at vertices) */}
                      {cell.walls.br && (
                        <line
                          x1={`${((x + 0.8) * 100) / cols}%`}
                          y1={`${((y + 0.8) * 100) / rows}%`}
                          x2={`${((x + 1.2) * 100) / cols}%`}
                          y2={`${((y + 1.2) * 100) / rows}%`}
                          stroke="#94a3b8"
                          strokeWidth="4"
                          strokeLinecap="round"
                        />
                      )}
                      {cell.walls.bl && (
                        <line
                          x1={`${((x + 0.2) * 100) / cols}%`}
                          y1={`${((y + 0.8) * 100) / rows}%`}
                          x2={`${((x - 0.2) * 100) / cols}%`}
                          y2={`${((y + 1.2) * 100) / rows}%`}
                          stroke="#94a3b8"
                          strokeWidth="4"
                          strokeLinecap="round"
                        />
                      )}
                    </React.Fragment>
                  )),
                )}

                {/* Score Lines */}
                {drawnLines.map((line) => (
                  <line
                    key={line.id}
                    x1={`${((line.x1 + 0.5) * 100) / cols}%`}
                    y1={`${((line.y1 + 0.5) * 100) / rows}%`}
                    x2={`${((line.x2 + 0.5) * 100) / cols}%`}
                    y2={`${((line.y2 + 0.5) * 100) / rows}%`}
                    stroke={line.color}
                    strokeWidth="6"
                    strokeLinecap="round"
                    className="opacity-90 drop-shadow-[0_0_8px_rgba(255,255,255,0.7)]"
                  />
                ))}
              </svg>

              {/* RENDER CELLS */}
              {board.map((row, y) =>
                row.map((cell, x) => {
                  const isVoid = cell.type === "void";
                  return (
                    <div
                      key={`${y}-${x}`}
                      onPointerDown={(e) => handleCellInteract(x, y, e)}
                      onPointerEnter={(e) => handleCellInteract(x, y, e)}
                      onPointerMove={(e) => {
                        if (
                          isBuildMode &&
                          e.buttons === 1 &&
                          !isDragging.current &&
                          !isSpaceHeld
                        ) {
                          if (
                            ["dup", "zap", "mov"].includes(editorTool) &&
                            board[y][x].type === editorTool
                          ) {
                            if (board[y][x].dir !== lastMouseDir.current) {
                              let b = [...board];
                              b[y] = [...b[y]];
                              b[y][x] = {
                                ...b[y][x],
                                dir: lastMouseDir.current,
                              };
                              setBoard(b);
                            }
                          }
                        }
                      }}
                      className={`
                        relative w-full h-full transition-colors duration-200 box-border
                        ${isVoid ? "bg-transparent" : "border border-slate-950/80 bg-slate-800/60"}
                        ${!isVoid && cell.isTarget ? "bg-indigo-900/40 shadow-[inset_0_0_15px_rgba(99,102,241,0.3)]" : ""}
                        ${!isVoid && isBuildMode && !editorTool.startsWith("wall") ? "hover:bg-slate-700" : ""}
                        ${!isVoid && !isBuildMode && !cell.piece && !cell.type.startsWith("locked") ? "hover:bg-slate-700 cursor-pointer" : ""}
                        ${!isBuildMode && (cell.piece || cell.type.startsWith("locked")) ? "cursor-default" : ""}
                      `}
                    >
                      {/* WALL EDITOR OVERLAYS */}
                      {!isVoid && isBuildMode && editorTool === "wall" && (
                        <>
                          <div
                            className="absolute top-0 left-1/4 w-1/2 h-1/4 hover:bg-emerald-400/50 z-40 cursor-crosshair"
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              toggleWall(x, y, "t");
                            }}
                          />
                          <div
                            className="absolute bottom-0 left-1/4 w-1/2 h-1/4 hover:bg-emerald-400/50 z-40 cursor-crosshair"
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              toggleWall(x, y, "b");
                            }}
                          />
                          <div
                            className="absolute top-1/4 left-0 w-1/4 h-1/2 hover:bg-emerald-400/50 z-40 cursor-crosshair"
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              toggleWall(x, y, "l");
                            }}
                          />
                          <div
                            className="absolute top-1/4 right-0 w-1/4 h-1/2 hover:bg-emerald-400/50 z-40 cursor-crosshair"
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              toggleWall(x, y, "r");
                            }}
                          />

                          <div
                            className="absolute top-0 left-0 w-1/4 h-1/4 hover:bg-amber-400/50 z-40 cursor-crosshair"
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              toggleWall(x, y, "tl");
                            }}
                          />
                          <div
                            className="absolute top-0 right-0 w-1/4 h-1/4 hover:bg-amber-400/50 z-40 cursor-crosshair"
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              toggleWall(x, y, "tr");
                            }}
                          />
                          <div
                            className="absolute bottom-0 left-0 w-1/4 h-1/4 hover:bg-amber-400/50 z-40 cursor-crosshair"
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              toggleWall(x, y, "bl");
                            }}
                          />
                          <div
                            className="absolute bottom-0 right-0 w-1/4 h-1/4 hover:bg-amber-400/50 z-40 cursor-crosshair"
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              toggleWall(x, y, "br");
                            }}
                          />
                        </>
                      )}

                      {!isVoid && (
                        <div
                          style={{
                            transform: ["zap", "mov", "dup"].includes(cell.type)
                              ? `rotate(${
                                  { u: 0, r: 90, d: 180, l: 270 }[cell.dir] || 0
                                }deg)`
                              : "none",
                          }}
                          className={`absolute inset-0 flex items-center justify-center pointer-events-none p-1.5 select-none`}
                        >
                          {(() => {
                            const bgIcon = getCellBgIcon(cell);
                            if (!bgIcon) return null;

                            return (
                              <>
                                {/* Base Cell Icon */}
                                <img
                                  src={`/icons/${bgIcon}.svg`}
                                  alt={cell.type}
                                  style={{
                                    width: `${iconSizes[cell.type] || 32}px`,
                                    height: `${iconSizes[cell.type] || 32}px`,
                                  }}
                                  className={`absolute z-0 opacity-80 pointer-events-none transition-all ${
                                    cell.type === "rot_ccw"
                                      ? "-scale-x-100"
                                      : ""
                                  }`}
                                />

                                {/* Layered Modifiers */}
                                {cell.mechanicalLock && (
                                  <img
                                    src="/icons/Lock.svg"
                                    alt="locked_mech"
                                    style={{
                                      width: `${iconSizes.locked_mech || 32}px`,
                                      height: `${iconSizes.locked_mech || 32}px`,
                                    }}
                                    className="absolute z-20 pointer-events-none"
                                  />
                                )}
                                {cell.flipMod && (
                                  <img
                                    src="/icons/Flip.svg"
                                    alt="flip"
                                    style={{
                                      width: `${iconSizes.flip || 32}px`,
                                      height: `${iconSizes.flip || 32}px`,
                                    }}
                                    className="absolute z-5 pointer-events-none"
                                  />
                                )}
                              </>
                            );
                          })()}

                          {/* Player Piece Icon */}
                          {cell.piece && (
                            <img
                              src={`/icons/${cell.piece === "N" ? "Neutral" : cell.piece}.svg`}
                              alt={cell.piece}
                              style={{
                                width: `${iconSizes[cell.piece] || 40}px`,
                                height: `${iconSizes[cell.piece] || 40}px`,
                              }}
                              className={`absolute z-10 transition-all duration-300 select-none pointer-events-none
                    ${
                      cell.dead && cell.piece !== "N"
                        ? "opacity-30 grayscale blur-[0.5px]"
                        : "drop-shadow-[0_0_8px_rgba(255,255,255,0.6)]"
                    }`}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                }),
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
