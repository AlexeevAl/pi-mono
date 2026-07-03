import { useState, useEffect, useRef } from "react";
import { Command, Child } from "@tauri-apps/plugin-shell";
import { resolveResource, appDataDir } from "@tauri-apps/api/path";
import QRCode from "qrcode";

interface ChatConfig {
  enabled: boolean;
  targetLang: string;
  contactGender?: "male" | "female";
}

interface TranslationEvent {
  chatId: string;
  type: "incoming" | "outgoing";
  original: string;
  translated: string;
  timestamp: number;
}

// Detect if running inside Tauri
const isTauri = typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__ !== undefined;

function App() {
  // Config state loaded from localStorage or defaults
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("wa_openai_api_key") || "");
  const [provider, setProvider] = useState(() => localStorage.getItem("wa_provider") || "openai");
  const [model, setModel] = useState(() => localStorage.getItem("wa_model") || "gpt-5.4-nano");
  
  // App runtime states
  const [backendStatus, setBackendStatus] = useState<"stopped" | "starting" | "running" | "error">("stopped");
  const [connectionStatus, setConnectionStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [qrCodeText, setQrCodeText] = useState("");
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [showApiKey, setShowApiKey] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Chats and translation history states
  const [chats, setChats] = useState<Record<string, ChatConfig>>({});
  const [translations, setTranslations] = useState<TranslationEvent[]>([]);
  const [newChatId, setNewChatId] = useState("");
  const [newChatLang, setNewChatLang] = useState("he");

  const childRef = useRef<Child | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const translationsEndRef = useRef<HTMLDivElement | null>(null);
  const demoIntervalRef = useRef<any>(null);

  // Save config changes
  useEffect(() => {
    localStorage.setItem("wa_openai_api_key", apiKey);
  }, [apiKey]);

  useEffect(() => {
    localStorage.setItem("wa_provider", provider);
  }, [provider]);

  useEffect(() => {
    localStorage.setItem("wa_model", model);
  }, [model]);

  // Handle QR code generation
  useEffect(() => {
    if (qrCodeText) {
      QRCode.toDataURL(qrCodeText, { width: 220, margin: 2 })
        .then(url => setQrCodeUrl(url))
        .catch(err => {
          console.error("QR Code generation error:", err);
          appendLog(`[GUI Error] Failed to generate QR Code image: ${err.message}`);
        });
    } else {
      setQrCodeUrl("");
    }
  }, [qrCodeText]);

  // Auto-scroll logs & translations
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    translationsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [translations]);

  const appendLog = (msg: string) => {
    setLogs(prev => [...prev.slice(-199), msg]);
  };

  // Stdin commands helper
  const sendStdinCommand = async (commandObj: any) => {
    if (!isTauri) return;
    if (!childRef.current) return;
    try {
      const payload = JSON.stringify(commandObj) + "\n";
      await childRef.current.write(payload);
    } catch (err: any) {
      appendLog(`[GUI Error] Failed to write to backend process: ${err.message}`);
    }
  };

  // Start the translator backend
  const startBackend = async () => {
    if (backendStatus === "running" || backendStatus === "starting") return;

    setBackendStatus("starting");
    setErrorMsg("");
    setQrCodeText("");
    setConnectionStatus("disconnected");
    setChats({});
    setTranslations([]);
    appendLog(isTauri ? "[GUI] Starting translation backend process..." : "[Demo Mode] Starting simulation in web browser...");

    // Web Browser Demo Simulation
    if (!isTauri) {
      setTimeout(() => {
        setQrCodeText("https://wa.me/qr/demo-simulation-code");
        setConnectionStatus("connecting");
        appendLog("[Demo Mode] WhatsApp session initialized, scan QR code below:");
        
        setTimeout(() => {
          setConnectionStatus("connected");
          setQrCodeText("");
          setBackendStatus("running");
          appendLog("[Demo Mode] ✅ Connected to WhatsApp.");
          
          setChats({
            "972501234567@s.whatsapp.net": { enabled: true, targetLang: "he", contactGender: "male" },
            "79123456789@s.whatsapp.net": { enabled: false, targetLang: "en", contactGender: "female" }
          });
          appendLog("[Demo Mode] Loaded simulated active chats.");

          // Start simulating translation events
          const simulatedDialog = [
            { original: "Привет, как дела?", translated: "שלום, מה שלומך?", type: "outgoing" as const },
            { original: "הכל טוב, מה איתך?", translated: "🇷🇺 Все хорошо, как у тебя?", type: "incoming" as const },
            { original: "Я сделал интеграцию переводчика в одном окне!", translated: "עשיתי אינטגרציה של מתרגם בחלון אחד!", type: "outgoing" as const },
            { original: "זה פשוט מדהים! תודה רבה לך", translated: "🇷🇺 Это просто потрясающе! Спасибо тебе большое", type: "incoming" as const }
          ];

          let idx = 0;
          demoIntervalRef.current = setInterval(() => {
            if (idx < simulatedDialog.length) {
              const current = simulatedDialog[idx];
              setTranslations(prev => [...prev, {
                chatId: "972501234567@s.whatsapp.net",
                type: current.type,
                original: current.original,
                translated: current.translated,
                timestamp: Date.now()
              }]);
              appendLog(`[Demo Mode Log] Translation processed for 972501234567`);
              idx++;
            } else {
              clearInterval(demoIntervalRef.current);
            }
          }, 5000);

        }, 4000);
      }, 1500);
      return;
    }

    // Standard Tauri sidecar startup
    try {
      const scriptPath = await resolveResource("_up_/_up_/wa-translate/dist/main.js");
      appendLog(`[GUI] Resolved backend script path: ${scriptPath}`);

      const dataDir = await appDataDir();
      appendLog(`[GUI] App data directory (writeable): ${dataDir}`);

      const cmd = Command.sidecar("binaries/wa-translate-backend", [scriptPath], {
        env: {
          PROVIDER: provider,
          MODEL: model,
          OPENAI_API_KEY: apiKey,
          WA_DATA_DIR: dataDir,
        }
      });

      // Listen for stdout
      cmd.stdout.on("data", (data: string) => {
        const lines = data.split("\n");
        for (let line of lines) {
          line = line.trim();
          if (!line) continue;
          
          if (line.startsWith("[CHATS]")) {
            try {
              const chatsJson = line.substring("[CHATS]".length).trim();
              const parsed = JSON.parse(chatsJson);
              setChats(parsed.chats || {});
            } catch (e: any) {
              appendLog(`[GUI Error] Failed to parse chats update: ${e.message}`);
            }
            continue;
          }

          if (line.startsWith("[TRANSLATION]")) {
            try {
              const translationJson = line.substring("[TRANSLATION]".length).trim();
              const event = JSON.parse(translationJson) as TranslationEvent;
              setTranslations(prev => [...prev.slice(-99), event]);
            } catch (e: any) {
              appendLog(`[GUI Error] Failed to parse translation event: ${e.message}`);
            }
            continue;
          }

          appendLog(line);

          if (line.includes("[QR_CODE]")) {
            const match = line.match(/\[QR_CODE\]\s*(.+)/);
            if (match && match[1]) {
              setQrCodeText(match[1].trim());
              setConnectionStatus("connecting");
            }
          } else if (line.includes("[STATUS]")) {
            const match = line.match(/\[STATUS\]\s*(\w+)/);
            if (match && match[1]) {
              const status = match[1].trim();
              if (status === "connected") {
                setConnectionStatus("connected");
                setQrCodeText("");
                setTimeout(() => {
                  sendStdinCommand({ type: "get_chats" });
                }, 500);
              } else if (status === "disconnected") {
                setConnectionStatus("disconnected");
              }
            }
          }
        }
      });

      // Listen for stderr
      cmd.stderr.on("data", (data: string) => {
        const lines = data.split("\n");
        for (let line of lines) {
          line = line.trim();
          if (line) {
            appendLog(`[Stderr] ${line}`);
          }
        }
      });

      cmd.on("close", (data) => {
        appendLog(`[GUI] Process exited with code ${data.code}`);
        setBackendStatus("stopped");
        setConnectionStatus("disconnected");
        setQrCodeText("");
        childRef.current = null;
      });

      cmd.on("error", (err) => {
        appendLog(`[GUI Error] Process error: ${err}`);
        setErrorMsg(String(err));
        setBackendStatus("error");
        childRef.current = null;
      });

      const child = await cmd.spawn();
      childRef.current = child;
      setBackendStatus("running");
      appendLog(`[GUI] Backend process spawned successfully (PID: ${child.pid}).`);

    } catch (err: any) {
      console.error("Failed to start backend:", err);
      setErrorMsg(err.message || String(err));
      setBackendStatus("error");
      appendLog(`[GUI Error] Failed to start backend: ${err.message || err}`);
    }
  };

  // Stop the translator backend
  const stopBackend = async () => {
    if (!isTauri) {
      if (demoIntervalRef.current) {
        clearInterval(demoIntervalRef.current);
      }
      setBackendStatus("stopped");
      setConnectionStatus("disconnected");
      setQrCodeText("");
      setChats({});
      setTranslations([]);
      appendLog("[Demo Mode] Simulation stopped.");
      return;
    }

    if (!childRef.current) return;
    appendLog("[GUI] Stopping backend process...");
    try {
      await childRef.current.kill();
      appendLog("[GUI] Sent kill signal to backend process.");
    } catch (err: any) {
      appendLog(`[GUI Error] Failed to kill process: ${err.message || err}`);
    }
    childRef.current = null;
    setBackendStatus("stopped");
    setConnectionStatus("disconnected");
    setQrCodeText("");
  };

  // Update chat settings in storage via stdin
  const updateChatConfig = (chatId: string, updatedConfig: Partial<ChatConfig>) => {
    const currentConfig = chats[chatId] || { enabled: false, targetLang: "he", contactGender: "male" };
    const merged = { ...currentConfig, ...updatedConfig };
    
    if (!isTauri) {
      setChats(prev => ({
        ...prev,
        [chatId]: merged
      }));
      appendLog(`[Demo Mode] Updated chat config for ${formatJid(chatId)}`);
      return;
    }

    sendStdinCommand({
      type: "set_chat_config",
      chatId,
      config: merged
    });
  };

  // Add chat form submit handler
  const handleAddChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatId.trim()) return;

    let formattedJid = newChatId.trim();
    if (!formattedJid.includes("@")) {
      formattedJid = formattedJid.replace(/[+\s-]/g, "");
      formattedJid = `${formattedJid}@s.whatsapp.net`;
    }

    updateChatConfig(formattedJid, { enabled: true, targetLang: newChatLang, contactGender: "male" });
    setNewChatId("");
  };

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      if (demoIntervalRef.current) {
        clearInterval(demoIntervalRef.current);
      }
      if (childRef.current) {
        childRef.current.kill().catch(console.error);
      }
    };
  }, []);

  // Format JID to reader-friendly phone number
  const formatJid = (jid: string) => {
    return jid.split("@")[0];
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.logoArea}>
          <div style={styles.logoBubble}>🟢</div>
          <h1 style={styles.title}>
            WhatsApp Translator AI {!isTauri && <span style={{ color: "#ffeb3b", fontSize: "0.8rem" }}>(Demo Mode)</span>}
          </h1>
        </div>
        <div style={styles.statusGroup}>
          <div style={styles.statusItem}>
            <span style={styles.statusLabel}>Процесс:</span>
            <span style={{
              ...styles.statusValue,
              color: backendStatus === "running" ? "#00e676" : backendStatus === "starting" ? "#ffeb3b" : "#ef4444"
            }}>
              {backendStatus === "running" ? "Запущен" : backendStatus === "starting" ? "Запуск..." : "Остановлен"}
            </span>
          </div>
          <div style={styles.statusItem}>
            <span style={styles.statusLabel}>WhatsApp:</span>
            <span style={{
              ...styles.statusValue,
              color: connectionStatus === "connected" ? "#00e676" : connectionStatus === "connecting" ? "#ffeb3b" : "#8696a0"
            }}>
              {connectionStatus === "connected" ? "Подключен" : connectionStatus === "connecting" ? "Авторизация..." : "Отключен"}
            </span>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main style={styles.main}>
        {/* Left Column - Configuration & Chat List */}
        <div style={styles.columnLeft}>
          {/* Config card */}
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>Настройки интеграции</h2>
            
            <div style={styles.formRow}>
              <div style={{ ...styles.formGroup, flex: 2 }}>
                <label style={styles.label}>OpenAI API Key</label>
                <div style={styles.inputWithToggle}>
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-proj-..."
                    style={styles.input}
                    disabled={backendStatus === "running" || backendStatus === "starting"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    style={styles.toggleBtn}
                  >
                    {showApiKey ? "Скрыть" : "Показать"}
                  </button>
                </div>
              </div>

              <div style={{ ...styles.formGroup, flex: 1 }}>
                <label style={styles.label}>Провайдер</label>
                <input
                  type="text"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  placeholder="openai"
                  style={styles.input}
                  disabled={backendStatus === "running" || backendStatus === "starting"}
                />
              </div>

              <div style={{ ...styles.formGroup, flex: 1.2 }}>
                <label style={styles.label}>Модель</label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="gpt-5.4-nano"
                  style={styles.input}
                  disabled={backendStatus === "running" || backendStatus === "starting"}
                />
              </div>

              <div style={styles.buttonGroupInline}>
                {backendStatus === "running" || backendStatus === "starting" ? (
                  <button onClick={stopBackend} style={{ ...styles.button, backgroundColor: "#ef4444" }}>
                    Остановить
                  </button>
                ) : (
                  <button onClick={startBackend} style={{ ...styles.button, backgroundColor: "#00a884" }}>
                    Запустить
                  </button>
                )}
              </div>
            </div>

            {errorMsg && (
              <div style={styles.errorBox}>
                <strong>Ошибка:</strong> {errorMsg}
              </div>
            )}
          </section>

          {/* Active Chats card */}
          <section style={{ ...styles.card, flex: 1, marginTop: "1rem" }}>
            <h2 style={styles.cardTitle}>Управление чатами WhatsApp</h2>
            
            {/* Form to add chat */}
            <form onSubmit={handleAddChat} style={styles.addChatForm}>
              <input
                type="text"
                value={newChatId}
                onChange={(e) => setNewChatId(e.target.value)}
                placeholder="Номер телефона (например, 79991234567)"
                style={{ ...styles.input, flex: 2 }}
                disabled={connectionStatus !== "connected"}
              />
              <select
                value={newChatLang}
                onChange={(e) => setNewChatLang(e.target.value)}
                style={{ ...styles.select, flex: 1 }}
                disabled={connectionStatus !== "connected"}
              >
                <option value="he">Hebrew (🇮🇱)</option>
                <option value="en">English (🇺🇸)</option>
                <option value="es">Spanish (🇪🇸)</option>
                <option value="fr">French (🇫🇷)</option>
                <option value="de">German (🇩🇪)</option>
              </select>
              <button
                type="submit"
                style={{ ...styles.button, flex: 0.8, backgroundColor: "#00a884" }}
                disabled={connectionStatus !== "connected"}
              >
                Добавить
              </button>
            </form>

            {/* Chat List container */}
            <div style={styles.chatListContainer}>
              {Object.keys(chats).length === 0 ? (
                <div style={styles.emptyChatsText}>
                  {connectionStatus === "connected" 
                    ? "Нет активных чатов. Добавьте номер телефона выше для начала перевода."
                    : "Подключите WhatsApp для управления чатами."
                  }
                </div>
              ) : (
                <table style={styles.chatsTable}>
                  <thead>
                    <tr>
                      <th style={styles.tableHeader}>Номер</th>
                      <th style={styles.tableHeader}>Перевод</th>
                      <th style={styles.tableHeader}>Язык</th>
                      <th style={styles.tableHeader}>Пол</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(chats).map(([chatId, config]) => (
                      <tr key={chatId} style={styles.tableRow}>
                        <td style={styles.tableCell}>{formatJid(chatId)}</td>
                        <td style={styles.tableCell}>
                          <input
                            type="checkbox"
                            checked={config.enabled}
                            onChange={(e) => updateChatConfig(chatId, { enabled: e.target.checked })}
                            style={styles.checkbox}
                          />
                        </td>
                        <td style={styles.tableCell}>
                          <select
                            value={config.targetLang}
                            onChange={(e) => updateChatConfig(chatId, { targetLang: e.target.value })}
                            style={styles.tableSelect}
                          >
                            <option value="he">Hebrew (🇮🇱)</option>
                            <option value="en">English (🇺🇸)</option>
                            <option value="es">Spanish (🇪🇸)</option>
                            <option value="fr">French (🇫🇷)</option>
                            <option value="de">German (🇩🇪)</option>
                          </select>
                        </td>
                        <td style={styles.tableCell}>
                          <select
                            value={config.contactGender || "male"}
                            onChange={(e) => updateChatConfig(chatId, { contactGender: e.target.value as any })}
                            style={styles.tableSelect}
                          >
                            <option value="male">👨 Мужской</option>
                            <option value="female">👩 Женский</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>

        {/* Right Column - Status & QR Code or Translation History */}
        <div style={styles.columnRight}>
          <section style={{ ...styles.card, height: "100%" }}>
            <h2 style={styles.cardTitle}>Подключение и переводы</h2>
            
            {connectionStatus !== "connected" ? (
              // Not connected: Show QR code / Loading status
              qrCodeUrl ? (
                <div style={styles.qrContainer}>
                  <p style={styles.qrInstruction}>Отсканируйте этот QR-код вашим телефоном в приложении WhatsApp:</p>
                  <div style={styles.qrFrame}>
                    <img src={qrCodeUrl} alt="WhatsApp QR Code" style={styles.qrImage} />
                  </div>
                  <p style={styles.qrLoadingText}>Ожидание сканирования...</p>
                </div>
              ) : (
                <div style={styles.emptyState}>
                  <p>Запустите сервис перевода для авторизации в WhatsApp.</p>
                  {backendStatus === "starting" && (
                    <div style={styles.loadingSpinner}>Инициализация сессии Baileys...</div>
                  )}
                </div>
              )
            ) : (
              // Connected: Show real-time translations log feed
              <div style={styles.translationContainer}>
                <div style={styles.translationHeader}>
                  <span style={styles.translationHeaderTitle}>Лента автопереводов в реальном времени</span>
                  <button onClick={() => setTranslations([])} style={styles.clearBtnInline}>Сбросить историю</button>
                </div>
                
                <div style={styles.translationFeed}>
                  {translations.length === 0 ? (
                    <div style={styles.emptyFeedText}>
                      Ожидание сообщений... Новые автопереводы будут появляться здесь автоматически.
                    </div>
                  ) : (
                    translations.map((event, index) => (
                      <div key={index} style={{
                        ...styles.translationItem,
                        alignSelf: event.type === "outgoing" ? "flex-end" : "flex-start",
                        backgroundColor: event.type === "outgoing" ? "#005c4b" : "#2a3942"
                      }}>
                        <div style={styles.translationMeta}>
                          <span style={styles.translationPhone}>{formatJid(event.chatId)}</span>
                          <span style={styles.translationDirection}>
                            {event.type === "outgoing" ? "Исходящее" : "Входящее"}
                          </span>
                        </div>
                        <div style={styles.translationOriginal}>{event.original}</div>
                        <div style={styles.translationDivider} />
                        <div style={styles.translationResult}>{event.translated}</div>
                        <div style={styles.translationTime}>
                          {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={translationsEndRef} />
                </div>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Terminal Logs */}
      <footer style={styles.logsFooter}>
        <div style={styles.logsHeader}>
          <h3>Логи консоли переводчика</h3>
          <button onClick={() => setLogs([])} style={styles.clearBtn}>Очистить</button>
        </div>
        <div style={styles.logsConsole}>
          {logs.map((log, idx) => (
            <div key={idx} style={styles.logLine}>{log}</div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </footer>
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100vh",
    backgroundColor: "#121b22",
    color: "#e9edef",
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.75rem 1.5rem",
    backgroundColor: "#1f2c34",
    borderBottom: "1px solid #2a3942",
  },
  logoArea: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  logoBubble: {
    fontSize: "1.25rem",
  },
  title: {
    fontSize: "1.1rem",
    fontWeight: "600",
    color: "#e9edef",
    margin: 0,
  },
  statusGroup: {
    display: "flex",
    gap: "1.5rem",
  },
  statusItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    fontSize: "0.85rem",
  },
  statusLabel: {
    color: "#8696a0",
  },
  statusValue: {
    fontWeight: "bold",
  },
  main: {
    display: "flex",
    flex: 1,
    padding: "1rem",
    gap: "1rem",
    overflow: "hidden",
  },
  columnLeft: {
    flex: 1.2,
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
  },
  columnRight: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
  },
  card: {
    display: "flex",
    flexDirection: "column" as const,
    backgroundColor: "#1f2c34",
    borderRadius: "8px",
    padding: "1rem",
    border: "1px solid #2a3942",
    boxShadow: "0 4px 6px rgba(0, 0, 0, 0.2)",
    overflow: "hidden",
  },
  cardTitle: {
    fontSize: "1rem",
    color: "#00a884",
    marginTop: 0,
    marginBottom: "1rem",
    borderBottom: "1px solid #2a3942",
    paddingBottom: "0.4rem",
  },
  formRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: "0.75rem",
  },
  formGroup: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.35rem",
  },
  label: {
    fontSize: "0.8rem",
    color: "#8696a0",
  },
  input: {
    width: "100%",
    padding: "0.6rem 0.75rem",
    backgroundColor: "#2a3942",
    border: "1px solid #2a3942",
    borderRadius: "6px",
    color: "#e9edef",
    fontSize: "0.9rem",
    outline: "none",
    boxSizing: "border-box" as const,
  },
  select: {
    padding: "0.6rem 0.75rem",
    backgroundColor: "#2a3942",
    border: "1px solid #2a3942",
    borderRadius: "6px",
    color: "#e9edef",
    fontSize: "0.9rem",
    outline: "none",
  },
  inputWithToggle: {
    position: "relative" as const,
    display: "flex",
    alignItems: "center",
  },
  toggleBtn: {
    position: "absolute" as const,
    right: "10px",
    backgroundColor: "transparent",
    border: "none",
    color: "#00a884",
    cursor: "pointer",
    fontSize: "0.75rem",
    outline: "none",
  },
  buttonGroupInline: {
    display: "flex",
    alignItems: "center",
  },
  button: {
    padding: "0.6rem 1.2rem",
    border: "none",
    borderRadius: "6px",
    color: "#ffffff",
    fontSize: "0.9rem",
    fontWeight: "bold",
    cursor: "pointer",
    transition: "background-color 0.2s",
  },
  errorBox: {
    marginTop: "0.75rem",
    padding: "0.6rem",
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    border: "1px solid #ef4444",
    borderRadius: "6px",
    color: "#ef4444",
    fontSize: "0.8rem",
  },
  addChatForm: {
    display: "flex",
    gap: "0.5rem",
    marginBottom: "1rem",
  },
  chatListContainer: {
    flex: 1,
    overflowY: "auto" as const,
    border: "1px solid #2a3942",
    borderRadius: "6px",
    backgroundColor: "#121b22",
  },
  emptyChatsText: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#8696a0",
    fontSize: "0.85rem",
    textAlign: "center" as const,
    padding: "2rem",
  },
  chatsTable: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: "0.85rem",
    textAlign: "left" as const,
  },
  tableHeader: {
    padding: "0.6rem 0.75rem",
    borderBottom: "1px solid #2a3942",
    color: "#8696a0",
    fontWeight: "600",
  },
  tableRow: {
    borderBottom: "1px solid #1f2c34",
  },
  tableCell: {
    padding: "0.6rem 0.75rem",
    verticalAlign: "middle",
  },
  checkbox: {
    width: "16px",
    height: "16px",
    accentColor: "#00a884",
    cursor: "pointer",
  },
  tableSelect: {
    backgroundColor: "#2a3942",
    border: "1px solid #2a3942",
    borderRadius: "4px",
    color: "#e9edef",
    padding: "0.25rem 0.4rem",
    fontSize: "0.8rem",
    outline: "none",
  },
  emptyState: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    color: "#8696a0",
    textAlign: "center" as const,
  },
  loadingSpinner: {
    marginTop: "1rem",
    color: "#ffeb3b",
    fontSize: "0.9rem",
  },
  qrContainer: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  qrInstruction: {
    fontSize: "0.85rem",
    color: "#e9edef",
    textAlign: "center" as const,
    marginBottom: "1rem",
    maxWidth: "240px",
    lineHeight: "1.4",
  },
  qrFrame: {
    backgroundColor: "#ffffff",
    padding: "0.6rem",
    borderRadius: "8px",
    boxShadow: "0 4px 10px rgba(0, 0, 0, 0.3)",
  },
  qrImage: {
    display: "block",
  },
  qrLoadingText: {
    fontSize: "0.8rem",
    color: "#ffeb3b",
    marginTop: "1rem",
  },
  translationContainer: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100%",
    overflow: "hidden",
  },
  translationHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "0.75rem",
  },
  translationHeaderTitle: {
    fontSize: "0.85rem",
    color: "#8696a0",
  },
  clearBtnInline: {
    backgroundColor: "transparent",
    border: "none",
    color: "#00a884",
    cursor: "pointer",
    fontSize: "0.75rem",
    outline: "none",
  },
  translationFeed: {
    flex: 1,
    overflowY: "auto" as const,
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.75rem",
    padding: "0.5rem",
    backgroundColor: "#121b22",
    borderRadius: "6px",
    border: "1px solid #2a3942",
  },
  emptyFeedText: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#8696a0",
    fontSize: "0.85rem",
    textAlign: "center" as const,
    padding: "2rem",
    lineHeight: "1.4",
  },
  translationItem: {
    maxWidth: "85%",
    borderRadius: "8px",
    padding: "0.6rem 0.8rem",
    color: "#e9edef",
    boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
    display: "flex",
    flexDirection: "column" as const,
  },
  translationMeta: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "0.75rem",
    color: "#8696a0",
    marginBottom: "0.25rem",
    gap: "1rem",
  },
  translationPhone: {
    fontWeight: "bold",
  },
  translationDirection: {
    fontStyle: "italic",
  },
  translationOriginal: {
    fontSize: "0.9rem",
    lineHeight: "1.4",
  },
  translationDivider: {
    height: "1px",
    backgroundColor: "rgba(255,255,255,0.1)",
    margin: "0.4rem 0",
  },
  translationResult: {
    fontSize: "0.9rem",
    lineHeight: "1.4",
    color: "#00e676",
    fontWeight: "500",
  },
  translationTime: {
    fontSize: "0.7rem",
    color: "#8696a0",
    textAlign: "right" as const,
    marginTop: "0.2rem",
  },
  logsFooter: {
    height: "140px",
    backgroundColor: "#0b141a",
    borderTop: "1px solid #2a3942",
    display: "flex",
    flexDirection: "column" as const,
  },
  logsHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.4rem 1.2rem",
    backgroundColor: "#1f2c34",
    borderBottom: "1px solid #2a3942",
    height: "30px",
    boxSizing: "border-box" as const,
  },
  clearBtn: {
    backgroundColor: "transparent",
    border: "none",
    color: "#8696a0",
    cursor: "pointer",
    fontSize: "0.75rem",
    outline: "none",
  },
  logsConsole: {
    flex: 1,
    padding: "0.75rem 1rem",
    fontFamily: "monospace",
    fontSize: "0.75rem",
    overflowY: "auto" as const,
    color: "#aebac1",
    lineHeight: "1.4",
  },
  logLine: {
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const,
    marginBottom: "0.25rem",
  },
};

export default App;
