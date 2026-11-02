const form = document.getElementById("login");
const errBox = document.getElementById("err");
const submit = document.getElementById("submit");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errBox.replaceChildren();
  submit.disabled = true;

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: document.getElementById("username").value,
        password: document.getElementById("password").value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      window.location.href = "/";
      return;
    }
    showError(data.error || "Anmeldung fehlgeschlagen");
  } catch {
    showError("Keine Verbindung zum Server");
  }
  submit.disabled = false;
});

function showError(text) {
  const box = document.createElement("div");
  box.className = "alert";
  box.textContent = text;
  errBox.replaceChildren(box);
}
