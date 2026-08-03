# PatchWorld Web Bridge - Example Template

> **This fork also hosts a contour-melody drawing app** (canvas + piano roll
> UI in `index.html`/`app.js`/`canvas.js`/`synth.js`/`api.js`/`config.js`,
> piano samples in `assets/piano/`). It's the static front-end for a
> separate, **private** research repo that runs the actual generation
> server (FastAPI + the trained model) — that server is not in this repo and
> never will be; this repo only ever contains what a browser downloads.
> See the sections below added for it. Everything above/below this note is
> the original PatchXR template documentation, kept intact for anyone
> forking this for a different (non-melody) Web Bridge project.
>
> ### Security note
> `config.js`'s `API_BASE_URL`/`API_KEY` are placeholders in this repo.
> **Any value shipped in a static site here is world-readable by URL** —
> GitHub Pages serves every file in this repo over plain HTTP(S), so a real
> API key committed here is not a secret, no matter what it's called. Once
> filled in locally for a real deployment, the actual protections are (a) an
> unguessable tunnel URL (cloudflared/ngrok, not a fixed/guessable hostname)
> and (b) server-side rate limiting on the FastAPI server — not the key
> itself. Treat `API_KEY` as basic hygiene/obfuscation (keeps casual
> scraping out), not access control.
>
> ### Attribution
> The piano samples in `assets/piano/` are rendered from a third-party
> soundfont (GeneralUser GS) — see [ATTRIBUTION.md](ATTRIBUTION.md) for
> license and render-settings details.

**[👉 See the Live Example Here!](https://patchxr.github.io/Patchworld-WebBridge-Template/)**

Welcome! This template is designed for PatchWorld players who want to build their own custom web interfaces (Web Bridge) to control or display things inside their PatchWorld worlds. You don't need to be an expert developer to use this!

## 🌐 What is this?
This repository contains a simple, working example of a web page that communicates directly with PatchWorld. 

**This web page is designed to be opened INSIDE PatchWorld** using the `webview_browser` block. Once loaded in your world, it acts as a powerful bridge that lets you script custom game logic using JavaScript!

With the Web Bridge, you unlock limitless creative possibilities:

### 🔌 Physical & Cable Connectivity
Plug cables directly into the bridge block in VR to interact with your scene:
- **Physical I/O Cables**: Send and receive strings (`Text Messages in/out`), trigger instant jolt pulses (`Jolt A / B`), or retrieve direct references to connected target blocks.

### 📡 Wireless Bridges
Communicate across the entire world without running physical cables:
- **Wireless Jolts**: Bidirectionally broadcast and subscribe to named wireless event channels anywhere in the room.
- **Reactive Variable System**: Subscribe to live gameplay variables (like `Score` or `Health`). Your UI updates automatically whenever the value changes, and you can get/set/remove variables on target blocks.

### ☁️ Cloud Data & Persistence
- **Online Server Storage**: Post and fetch persistent key-value data directly on the PatchXR backend servers to save player progress, high scores, or custom world states across sessions.

### 🎨 Scene & Block Manipulation
- **Set Serialization**: Dynamically apply partial or full `.patch` serialization strings to modify objects and create generative worlds on the fly.
- **Lifecycle & Transforms**: Spawn new blocks from the library, move and rotate objects in 3D space, lock/unlock items, or hide/remove blocks.
- **Internal Console Commands**: Run internal engine or AI console commands directly from JavaScript.

For a full list of commands and how the communication works behind the scenes, please refer to the [API Reference](API_Reference.md). *(Note: make sure `API_Reference.md` is copied into this repository!)*

---

## 🚀 How to get your own live Web Bridge (For Free!)

The easiest way to get started is to use **GitHub Pages** to host your website automatically.

### Step 1: Fork this repository
1. Sign in to your GitHub account.
2. Click the **Fork** button at the top right of this page to create a copy of this project on your own account.

### Step 2: Enable GitHub Pages
1. In your new forked repository, go to **Settings** (the gear icon).
2. On the left menu, click on **Pages**.
3. Under **Build and deployment** -> **Source**, select **Deploy from a branch**.
4. Under **Branch**, select `main` (or `master`) and `/ (root)`, then click **Save**.
5. Wait a few minutes. GitHub will give you a link at the top of the page (e.g., `https://your-username.github.io/Patchworld-WebBridge-Template/`). 
6. **This is your live Web Bridge URL!** Put this link into your PatchWorld browser block.

---

## 🤖 How to modify the code (Vibe Coding with AI)

You don't even need to download anything to change how your Web Bridge looks and works! You can use an AI assistant like **Bolt.new** to code it for you directly from your browser.

### Using Bolt.new to code with AI
1. Go to [Bolt.new](https://bolt.new) and log in with your GitHub account.
2. To allow Bolt to save your changes to GitHub, it needs a secure token. Open GitHub in a new tab.
3. Click your profile picture (top right) -> **Settings**.
4. Scroll to the very bottom left and click **Developer settings**.
5. Click **Personal access tokens** -> **Fine-grained tokens**, then **Generate new token**.
6. Under **Repository access**, choose **Only select repositories** and select your forked repository.
7. Scroll down to **Repository permissions**. Find **Contents** and change it from *Read-only* to **Read and write**.
8. Scroll to the bottom and click **Generate token**.
9. **Copy the token** and paste it into Bolt when it asks for credentials.
10. Give Bolt the URL of your repository and just tell the AI what you want (e.g., *"Change the background to dark mode and add a big red button that says 'Jolt'"*). 
11. Bolt will write the code and push it to your GitHub. Wait a minute or two, refresh your GitHub Pages URL, and enjoy your new interface!

---

## 💻 Advanced: Editing Locally
If you prefer to code the traditional way on your computer:
1. Install [Git for Windows](https://gitforwindows.org/) or [Git for Mac](https://git-scm.com/download/mac) if you don't have it.
2. Clone your repository using the terminal: 
   ```bash
   git clone https://github.com/YOUR-USERNAME/Patchworld-WebBridge-Template.git
   ```
3. Edit `index.html` with your favorite text editor (like VS Code or Notepad++).
4. Commit and push your changes back to GitHub. Your live website will update automatically!
