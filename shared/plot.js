// Shared Plotly dark-theme helpers.
export const COLORS = { gold: "#FFD700", blue: "#6699FF", green: "#66DD66", red: "#FF4444", orange: "#FFAA44" };

export const axisStyle = (extra = {}) => ({
  gridcolor: "rgba(170,170,170,0.15)", zerolinecolor: "rgba(170,170,170,0.3)",
  linecolor: "#555", mirror: true, ...extra,
});

export function layout(extra = {}) {
  return {
    paper_bgcolor: "#242424", plot_bgcolor: "#1a1a1a", font: { color: "#ccc", size: 11 },
    margin: { l: 56, r: 14, t: 36, b: 44 },
    legend: { x: 0.99, xanchor: "right", y: 0.99, bgcolor: "rgba(26,26,26,0.85)", font: { size: 10 } },
    uirevision: "keep", // keep the user's zoom/pan across slider updates
    ...extra,
  };
}

export const config = { responsive: true, displaylogo: false, scrollZoom: true };

export function draw(id, traces, lay) {
  return Plotly.react(id, traces, lay, config);
}
