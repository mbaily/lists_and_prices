const item = { isNote: false, name: 'Task 1', date: '' };
const depth = 0;
let html = `<div class="item" style="margin-left: ${depth * 2}ch">`;
html += item.isNote ? `<span class="note-mark">↳ </span>` : `<span class="bullet">• </span>`;
html += `Name</div>`;
console.log(html);
