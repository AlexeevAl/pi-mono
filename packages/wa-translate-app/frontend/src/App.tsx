import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

function App() {
  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif", textAlign: "center" }}>
      <h1 style={{ color: "#25D366" }}>WhatsApp Translator AI</h1>
      <p>Интеллектуальный переводчик сообщений</p>
      
      <div style={{ marginTop: "3rem", padding: "1rem", border: "1px solid #ddd", borderRadius: "8px" }}>
        <h3>Статус подключения</h3>
        <p>Для начала работы отсканируйте QR-код в терминале (или в этом окне после настройки связи).</p>
      </div>
    </div>
  );
}

export default App;
