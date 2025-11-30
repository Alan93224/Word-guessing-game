import React, { useState, useEffect, useRef } from 'react';
import { Clock, Send, HelpCircle, RefreshCw, AlertTriangle, Brain, Trophy, Skull } from 'lucide-react';

// 預設 API Key (來自使用者提供)
//const DEFAULT_GROQ_KEY = "API_KEY_HERE"; // 請自行填入預設的 Groq API Key 或存在環境變數中擷取

const App = () => {
  // --- State 管理 ---
  const [apiKey, setApiKey] = useState(DEFAULT_GROQ_KEY);
  const [gameState, setGameState] = useState('welcome'); // welcome, generating, playing, ended
  const [puzzle, setPuzzle] = useState(null); // { title, content, answer }
  const [chatHistory, setChatHistory] = useState([]);
  const [userInput, setUserInput] = useState('');
  const [timeLeft, setTimeLeft] = useState(180); // 3分鐘 = 180秒
  const [gameResult, setGameResult] = useState(null); // 'win' | 'lose' | 'giveup'
  const [isProcessing, setIsProcessing] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  const chatEndRef = useRef(null);

  // --- 捲動到底部 ---
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, isProcessing]);

  // --- 計時器邏輯 ---
  useEffect(() => {
    let timer;
    if (gameState === 'playing' && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && gameState === 'playing') {
      endGame('lose');
    }
    return () => clearInterval(timer);
  }, [gameState, timeLeft]);

  // --- 格式化時間 ---
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // --- API 呼叫工具 (Groq) ---
  const callGroqAPI = async (messages, jsonMode = false) => {
    try {
      const currentKey = apiKey.trim();

      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${currentKey}`
        },
        body: JSON.stringify({
          messages: messages,
          model: "llama-3.3-70b-versatile",
          temperature: 0.7,
          response_format: jsonMode ? { type: "json_object" } : undefined
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("API Error Details:", errorData);
        throw new Error(`API Error: ${response.status} - ${errorData?.error?.message || 'Unknown Error'}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error("API Call Failed:", error);
      alert(`連線錯誤：${error.message}\n請檢查 API Key 是否有效或網路連線。`);
      if (gameState === 'generating') {
        setGameState('welcome');
      }
      return null;
    }
  };

  // --- 產生題目 (修改為猜詞模式) ---
  const generatePuzzle = async () => {
    if (!apiKey) return alert("請輸入 API Key");

    setGameState('generating');
    setLoadingMessage('正在尋找謎題... (生成中)');

    const systemPrompt = `
      我們來玩一個「猜詞遊戲」，規則類似海龜湯的提問模式（Yes/No），但目標是猜出一個具體的「名詞」。
      請產生一個繁體中文的謎題。
      
      必須包含：
      1. 標題 (title): 該物品的類別（例如：動物、日常用品、職業、水果、交通工具）。
      2. 題目 (content): 一段對於該名詞的神秘描述或情境，嚴禁直接提到該名詞，可以擬人化或隱喻，讓玩家透過提問來猜。
      3. 答案 (answer): 該名詞（例如：蘋果、消防員、時鐘）。
      
      請嚴格回傳 JSON 格式，不要有其他廢話，格式如下：
      {
        "title": "類別",
        "content": "描述內容...",
        "answer": "目標名詞"
      }
    `;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: "請產生一個新的猜詞題目，確保輸出為合法的 JSON。" }
    ];

    const result = await callGroqAPI(messages, true);

    if (result) {
      try {
        const puzzleData = JSON.parse(result);
        setPuzzle(puzzleData);
        setChatHistory([{ role: 'assistant', content: '謎題已出。請閱讀題目，透過提問來猜出這個「詞」是什麼。你的時間只有 3 分鐘。' }]);
        setTimeLeft(180);
        setGameState('playing');
      } catch (e) {
        console.error("JSON Parse Error:", e);
        alert("生成的題目格式有誤，請重試。");
        setGameState('welcome');
      }
    }
  };

  // --- 玩家提問與 AI 判斷 (修改為猜詞判斷) ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!userInput.trim() || isProcessing || gameState !== 'playing') return;

    const question = userInput;
    setUserInput('');
    setChatHistory(prev => [...prev, { role: 'user', content: question }]);
    setIsProcessing(true);

    const systemPrompt = `
      你是一個「猜詞遊戲」的主持人。
      題目：${puzzle.content}
      正確答案（目標名詞）：${puzzle.answer}

      玩家剛問了一個問題或猜測："${question}"

      請遵守以下規則：
      1. 只能回答：「是」、「不是」、「沒有關係」。
      2. 如果玩家猜中了目標名詞（${puzzle.answer}），請回答「恭喜答對！」並將 solved 設為 true。
      3. 如果玩家猜了錯誤的名詞，回答「不是」。
      4. 如果玩家問特徵（例如：是紅色的嗎？），請根據正確答案回答 是/不是。
    `;

    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `請依照規則回傳 JSON 判斷結果，格式為 {"reply": "...", "solved": boolean}`
      }
    ];

    const result = await callGroqAPI(messages, true);

    if (result) {
      try {
        const judgment = JSON.parse(result);
        setChatHistory(prev => [...prev, { role: 'assistant', content: judgment.reply }]);

        if (judgment.solved) {
          setTimeout(() => endGame('win'), 1000);
        }
      } catch (e) {
        console.error("Parsing Error", e);
        if (!result.trim().startsWith('{')) {
          setChatHistory(prev => [...prev, { role: 'assistant', content: result }]);
        } else {
          setChatHistory(prev => [...prev, { role: 'assistant', content: "裁判去上廁所了... (系統錯誤，請重試)" }]);
        }
      }
    }
    setIsProcessing(false);
  };

  // --- 結束遊戲 ---
  const endGame = (result) => {
    setGameResult(result);
    setGameState('ended');
  };

  // --- UI 元件 ---

  // 1. 歡迎/設定畫面（置中版）
  if (gameState === 'welcome') {
    return (
      <div className="min-h-screen bg-gray-900 text-gray-100 flex items-center justify-center p-4">
        <div className="w-full max-w-lg mx-auto bg-gray-800 p-8 rounded-2xl shadow-2xl border border-gray-700">
          <div className="text-center mb-8">
            <div className="bg-blue-900/30 p-4 rounded-full inline-block mb-4">
              <Brain className="w-12 h-12 text-blue-400" />
            </div>
            <h1 className="text-3xl font-bold text-white tracking-wider">AI 猜詞挑戰</h1>
            <p className="text-gray-400 mt-2">3分鐘限時 • 提問猜名詞</p>
          </div>

          <div className="space-y-4">
            <button
              onClick={generatePuzzle}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-800 hover:from-blue-500 hover:to-blue-700 text-white font-bold py-3 px-6 rounded-lg transition-all transform hover:scale-[1.02] shadow-lg flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-5 h-5" />
              開始新題目
            </button>
          </div>

          <div className="mt-6 text-sm text-gray-500 bg-gray-900/50 p-3 rounded border border-gray-800">
            <h3 className="font-bold text-gray-400 mb-1 flex items-center gap-1">
              <HelpCircle className="w-4 h-4" /> 規則說明
            </h3>
            <ul className="list-disc list-inside space-y-1">
              <li>AI 會描述一個名詞（可能是物品、動物等）。</li>
              <li>你只能問「是／否」類型的問題。</li>
              <li>目標是猜出那個「詞」是什麼。</li>
              <li>限時 3 分鐘。</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // 2. 生成中畫面（本來就置中了，維持）
  if (gameState === 'generating') {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center">
        <div className="animate-spin text-blue-500 mb-4">
          <RefreshCw className="w-12 h-12" />
        </div>
        <p className="text-xl animate-pulse text-gray-300">{loadingMessage}</p>
      </div>
    );
  }

  // 3. 遊戲主畫面 & 結算畫面（你提供的置中版）
  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex items-center justify-center p-4">
      {/* 外層容器：限制寬度並置中 */}
      <div className="w-full max-w-5xl bg-gray-900 flex flex-col md:flex-row rounded-2xl shadow-2xl border border-gray-800 overflow-hidden">
        {/* 左側/上方：題目區 */}
        <div className="w-full md:w-1/3 bg-gray-800 border-b md:border-b-0 md:border-r border-gray-700 flex flex-col">
          <div className="p-6 flex-1 overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-blue-400 flex items-center gap-2">
                <Brain className="w-6 h-6" />
                當前謎題
              </h2>
              {gameState === 'playing' && (
                <div
                  className={`flex items-center gap-2 font-mono text-xl font-bold px-3 py-1 rounded ${timeLeft < 30
                    ? 'bg-red-900/50 text-red-400 animate-pulse'
                    : 'bg-gray-900 text-green-400'
                    }`}
                >
                  <Clock className="w-5 h-5" />
                  {formatTime(timeLeft)}
                </div>
              )}
            </div>

            <div className="bg-gray-900/50 p-5 rounded-xl border border-gray-700 shadow-inner">
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-1 bg-blue-900/50 text-blue-300 text-xs rounded border border-blue-800">
                  類別
                </span>
                <h3 className="text-xl font-bold text-white">{puzzle?.title}</h3>
              </div>
              <p className="text-lg leading-relaxed text-gray-300 whitespace-pre-wrap">
                {puzzle?.content}
              </p>
            </div>

            {gameState === 'ended' && (
              <div
                className={`mt-6 p-5 rounded-xl border animate-in fade-in slide-in-from-bottom-4 duration-700 ${gameResult === 'win'
                  ? 'bg-green-900/30 border-green-600'
                  : 'bg-red-900/30 border-red-600'
                  }`}
              >
                <div className="flex items-center gap-3 mb-3">
                  {gameResult === 'win' ? (
                    <Trophy className="w-8 h-8 text-yellow-400" />
                  ) : (
                    <Skull className="w-8 h-8 text-gray-400" />
                  )}
                  <h3 className="text-2xl font-bold text-white">
                    {gameResult === 'win'
                      ? '恭喜答對！'
                      : gameResult === 'giveup'
                        ? '已放棄挑戰'
                        : '時間到，挑戰失敗'}
                  </h3>
                </div>
                <div className="bg-black/40 p-4 rounded-lg mt-2">
                  <span className="text-xs text-gray-500 uppercase font-bold">
                    正確答案 (The Answer)
                  </span>
                  <p className="text-white mt-1 leading-relaxed text-xl font-bold">
                    {puzzle?.answer}
                  </p>
                </div>
                <button
                  onClick={() => generatePuzzle()}
                  className="mt-4 w-full bg-white text-gray-900 hover:bg-gray-200 font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" /> 再玩一次
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 右側/下方：對話區 */}
        <div className="w-full md:w-2/3 flex flex-col h-[60vh] md:h-[70vh]">
          {/* 聊天記錄 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent">
            {chatHistory.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-5 py-3 shadow-md ${msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-none'
                    : 'bg-gray-700 text-gray-200 rounded-bl-none border border-gray-600'
                    }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {isProcessing && (
              <div className="flex justify-start">
                <div className="bg-gray-700 text-gray-400 rounded-2xl rounded-bl-none px-5 py-3 text-sm animate-pulse">
                  AI 思考中...
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* 輸入區 */}
          <div className="p-4 bg-gray-800 border-t border-gray-700">
            {gameState === 'playing' ? (
              <form onSubmit={handleSubmit} className="flex gap-2">
                <button
                  type="button"
                  onClick={() => endGame('giveup')}
                  className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-4 rounded-lg transition-colors whitespace-nowrap"
                  title="放棄並查看答案"
                >
                  <AlertTriangle className="w-5 h-5" />
                </button>
                <input
                  type="text"
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  placeholder="提問特徵 (例如：是活的嗎？) 或直接猜詞..."
                  className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!userInput.trim() || isProcessing}
                  className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-6 rounded-lg transition-colors"
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>
            ) : (
              <div className="text-center text-gray-500 py-3">
                {gameState === 'ended'
                  ? '遊戲已結束，請點擊左側按鈕重新開始。'
                  : '準備開始...'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
