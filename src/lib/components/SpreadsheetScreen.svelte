<script lang="ts">
	// sheetId kept as prop so HomeScreen doesn't need changes
	let { sheetId: _sheetId, onBack }: { sheetId: string; onBack: () => void } = $props();
</script>

<div class="screen">
<header>
<button class="back-btn" onclick={onBack} aria-label="Back">←</button>
<span class="title">Spreadsheet</span>
</header>
<div class="notice">
<p>📊</p>
<p>Spreadsheets are not supported in this app.</p>
<p>Use <strong>Google Sheets</strong> instead — you can copy list data to the clipboard from the list's ⋮ menu and paste it directly into Google Sheets.</p>
<button onclick={onBack}>Go back</button>
</div>
</div>

<style>
.screen {
display: flex;
flex-direction: column;
position: fixed;
inset: 0;
background: var(--bg);
}
header {
display: flex;
align-items: center;
gap: 0.5rem;
padding: 0.5rem 0.75rem;
background: var(--bg2);
border-bottom: 1px solid var(--border);
flex-shrink: 0;
}
.back-btn {
background: none;
border: none;
font-size: 1.3rem;
color: var(--accent);
cursor: pointer;
padding: 0 0.25rem;
}
.title {
font-weight: 600;
font-size: 1rem;
}
.notice {
flex: 1;
display: flex;
flex-direction: column;
align-items: center;
justify-content: center;
gap: 0.75rem;
padding: 2rem;
text-align: center;
color: var(--text2);
}
.notice p:first-child { font-size: 3rem; }
.notice p { font-size: 0.95rem; max-width: 20rem; margin: 0; }
.notice strong { color: var(--text); }
.notice button {
margin-top: 0.5rem;
padding: 0.5rem 1.5rem;
background: var(--accent);
color: #fff;
border: none;
border-radius: 8px;
font-size: 0.95rem;
cursor: pointer;
}
</style>
