// The first preview acceptance example: a working circle size wireframe.
export const circlePreview = {
  "index.html": '<h1>Circle size</h1><label>Diameter <input type="range" min="20" max="300" data-bind="diameter"></label><strong data-text="diameter"></strong><div class="circle" data-width="diameter" data-height="diameter"></div>',
  "style.css": ".circle{border-radius:50%;background:#789;border:2px solid #345;margin:30px}label{display:block;padding:20px}",
  "script.js": 'const initialState = {diameter:120}; function update(state,event) { return event.type === "input" ? {...state,[event.name]:event.value} : state; }'
};
