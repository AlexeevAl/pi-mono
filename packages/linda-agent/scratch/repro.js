
async function test() {
  const actorId = "user_" + Date.now();
  
  console.log("Turn 1: I want to refresh my face");
  const res1 = await fetch("http://localhost:3035/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actorId, text: "I want to refresh my face" })
  });
  const data1 = await res1.json();
  console.log("Response 1:", JSON.stringify(data1, null, 2));

  console.log("\nTurn 2: увлажнение");
  const res2 = await fetch("http://localhost:3035/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actorId, text: "увлажнение" })
  });
  const data2 = await res2.json();
  console.log("Response 2:", JSON.stringify(data2, null, 2));
}

test().catch(console.error);
