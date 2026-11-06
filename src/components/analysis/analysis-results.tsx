"use client";

import { useMemo } from "react";
import { Download } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { VideoAnalysis } from "@/lib/pose-analysis";

function unavailable(value: number | null, unit: string) {
  return value === null ? "Não disponível" : `${value.toFixed(1)}${unit}`;
}

function angleRange(values: Array<number | null>) {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return finite.length ? `${Math.min(...finite).toFixed(1)}°–${Math.max(...finite).toFixed(1)}°` : "Não disponível";
}

export function AnalysisResults({ analysis }: { analysis: VideoAnalysis }) {
  const sampled = useMemo(() => analysis.series.filter((_, index) => index % Math.max(1, Math.ceil(analysis.series.length / 70)) === 0), [analysis]);
  const leftKneeRange = useMemo(() => angleRange(analysis.series.map((point) => point.leftKneeAngle)), [analysis.series]);
  const rightKneeRange = useMemo(() => angleRange(analysis.series.map((point) => point.rightKneeAngle)), [analysis.series]);
  function pdf() {
    import("jspdf").then(({ jsPDF }) => {
      const doc = new jsPDF();
      doc.setFontSize(22); doc.text("MOVA — Relatório experimental", 15, 20);
      doc.setFontSize(11); doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, 15, 30);
      doc.text(`Tempo de análise: ${unavailable(analysis.durationSeconds, " s")}`, 15, 42);
      doc.text(`Passos estimados: ${analysis.estimatedSteps ?? "Não disponível"}`, 15, 50);
      doc.text(`Cadência estimada: ${unavailable(analysis.cadenceSpm, " passos/min")}`, 15, 58);
      doc.text(`Velocidade média: ${unavailable(analysis.speedMps, " m/s")}`, 15, 66);
      doc.text(`Regularidade temporal: ${unavailable(analysis.stepRegularity, "%")}`, 15, 74);
      doc.text(`Taxa de detecção: ${unavailable(analysis.detectionRate === null ? null : analysis.detectionRate * 100, "%")}`, 15, 82);
      doc.text(`Confiabilidade temporal: ${analysis.gaitEstimateReliability}`, 15, 90);
      doc.text("Limitações:", 15, 104);
      let y = 112;
      analysis.limitations.concat("Indicadores experimentais; não constituem diagnóstico nem validação clínica.").forEach((text) => {
        const lines = doc.splitTextToSize(`• ${text}`, 175); doc.text(lines, 15, y); y += lines.length * 6;
      });
      doc.save("relatorio-mova-experimental.pdf");
    });
  }
  return <section className="card" style={{ marginTop: 20 }}>
    <div className="topline"><div><span className="eyebrow">Resultados calculados</span><h2 style={{ margin: "5px 0" }}>Revisão da análise</h2></div><button type="button" className="button primary" onClick={pdf}><Download size={17} />Baixar prévia local (não salva)</button></div>
    {analysis.gaitEstimateReliability === "insuficiente" && <p className="notice"><b>Estimativa indisponível ou não confiável.</b> A pose pode ter sido detectada, mas os eventos temporais não atendem aos critérios mínimos do MOVA.</p>}
    <div className="stats">
      <article className="stat"><small>Passos estimados</small><b>{analysis.estimatedSteps ?? "—"}</b><small className="muted">Picos experimentais de tornozelo</small></article>
      <article className="stat"><small>Cadência estimada</small><b>{unavailable(analysis.cadenceSpm, " spm")}</b><small className="muted">Dado experimental</small></article>
      <article className="stat"><small>Regularidade temporal</small><b>{unavailable(analysis.stepRegularity, "%")}</b><small className="muted">Intervalos entre picos</small></article>
      <article className="stat"><small>Qualidade da pose</small><b style={{ textTransform: "capitalize" }}>{analysis.quality}</b><small className="muted">{analysis.usableFrames}/{analysis.totalFrames} quadros úteis · {unavailable(analysis.detectionRate === null ? null : analysis.detectionRate * 100, "%")}</small></article>
    </div>
    <h3>Confiança de detecção por tempo</h3><div style={{ height: 220 }}><ResponsiveContainer><LineChart data={sampled}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="time" unit="s" /><YAxis domain={[0, 1]} /><Tooltip /><Line type="monotone" dataKey="confidence" stroke="#0b8078" dot={false} /></LineChart></ResponsiveContainer></div>
    <details className="notice"><summary><b>Diagnóstico local de sinais temporais</b> — não é salvo nem enviado</summary><p className="muted">O gráfico usa altura de tornozelo relativa ao quadril quando disponível. Ele serve para auditar o proxy; não identifica contato de solo.</p><div style={{ height: 220 }}><ResponsiveContainer><LineChart data={sampled}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="time" unit="s" /><YAxis /><Tooltip /><Line type="monotone" dataKey="leftAnkleRelativeY" stroke="#7c3aed" dot={false} name="Tornozelo esquerdo relativo" connectNulls /><Line type="monotone" dataKey="rightAnkleRelativeY" stroke="#e76f51" dot={false} name="Tornozelo direito relativo" connectNulls /></LineChart></ResponsiveContainer></div><ul>{analysis.signalDiagnostics.map((diagnostic) => <li key={diagnostic.signal}><b>{diagnostic.signal === "left_ankle_relative_y" ? "Esquerdo" : "Direito"}:</b> {diagnostic.accepted}/{diagnostic.candidates} picos aceitos; segmentos {diagnostic.contiguousSegments}; rejeitados por proeminência {diagnostic.rejectedByProminence}, espaçamento {diagnostic.rejectedBySpacing} e fronteira {diagnostic.rejectedByBoundary}.</li>)}</ul></details>
    <h3>Ângulos estimados dos joelhos</h3><p className="muted">Estimativas 2D da imagem; não são goniometria clínica validada.</p><p className="notice"><b>Faixa observada na imagem:</b> joelho esquerdo {leftKneeRange} · joelho direito {rightKneeRange}</p>
    <div style={{ height: 240 }}><ResponsiveContainer><LineChart data={sampled}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="time" unit="s" /><YAxis unit="°" domain={[0, 180]} /><Tooltip /><Line type="monotone" dataKey="leftKneeAngle" stroke="#7c3aed" dot={false} name="Joelho esquerdo" connectNulls /><Line type="monotone" dataKey="rightKneeAngle" stroke="#e76f51" dot={false} name="Joelho direito" connectNulls /></LineChart></ResponsiveContainer></div>
    <div className="notice"><b>Limitações:</b><ul>{analysis.limitations.map((item) => <li key={item}>{item}</li>)}</ul></div>
  </section>;
}
