"use client";
import { useState } from "react";
import { validReviewerId, validUncertainty, type GaitAnnotationDocument, type GaitAnnotationEvent } from "@/lib/gait-annotations";

function UncertaintyEditor({ event, onChange }: { event: GaitAnnotationEvent; onChange: (value: GaitAnnotationEvent["uncertaintyMs"]) => void }) {
  const [start, setStart] = useState(event.uncertaintyMs?.startMs.toString() ?? "");
  const [end, setEnd] = useState(event.uncertaintyMs?.endMs.toString() ?? "");
  const [message, setMessage] = useState("");
  return <fieldset><legend>Incerteza — {event.timeMs} ms / {event.side === "left" ? "esquerdo" : event.side === "right" ? "direito" : "indeterminado"}</legend>
    <label>Limite inferior (ms)<input className="field" type="number" min="0" step="1" value={start} onChange={e => setStart(e.target.value)} /></label>{" "}
    <label>Limite superior (ms)<input className="field" type="number" min="0" step="1" value={end} onChange={e => setEnd(e.target.value)} /></label>
    <div className="actions"><button className="button secondary" type="button" onClick={() => {
      const value = { startMs: Number(start), endMs: Number(end) };
      if (!start || !end || !validUncertainty(event.timeMs, value)) { setMessage("Os limites inteiros devem conter o instante do evento e não podem ser negativos."); return; }
      onChange(value); setMessage("Intervalo registrado. Não equivale a contato confirmado.");
    }}>Salvar incerteza</button><button className="button secondary" type="button" onClick={() => { onChange(undefined); setStart(""); setEnd(""); setMessage("Incerteza removida; não presumir erro zero."); }}>Limpar incerteza</button></div>
    <output>{event.uncertaintyMs ? `${event.uncertaintyMs.startMs}–${event.uncertaintyMs.endMs} ms` : "Incerteza não informada"}</output><p role="status">{message}</p>
  </fieldset>;
}

/** Somente anotação experimental. Não produz eventos, sugestões ou rótulos para a rede. */
export function GaitAnnotationReview({ document, onNew, onRestore, onUncertainty }: {
  document: GaitAnnotationDocument; onNew: (id: string) => void; onRestore: (id: string) => void;
  onUncertainty: (eventId: string, value: GaitAnnotationEvent["uncertaintyMs"]) => void;
}) {
  const [reviewer, setReviewer] = useState("");
  return <details><summary>Revisão experimental: revisor e incerteza temporal</summary>
    <p>Use códigos como R01 e R02, sem nome ou e-mail. Cada nova revisão começa vazia, sem copiar contatos. Exporte cada revisão separadamente. Isso não comprova independência por si só.</p>
    <label>ID pseudônimo do revisor<input className="field" maxLength={32} value={reviewer} onChange={e => setReviewer(e.target.value)} /></label>
    <div className="actions"><button className="button secondary" type="button" disabled={!validReviewerId(reviewer)} onClick={() => onNew(reviewer)}>Iniciar revisão independente</button><button className="button secondary" type="button" disabled={!validReviewerId(reviewer)} onClick={() => onRestore(reviewer)}>Recuperar revisão pelo código</button></div>
    <p>Revisor ativo: <b>{document.reviewerId ?? "Não informado (documento legado)"}</b></p>
    <p>Informe o intervalo entre o último quadro sem contato e o primeiro com contato, quando observável. Não copie escores da TCN. Ausência de intervalo não significa incerteza zero. Marcações desta tela são apenas desenvolvimento, não exigência do atendimento clínico.</p>
    {document.events.map(event => <UncertaintyEditor key={`${document.reviewerId ?? "legacy"}:${event.id}:${event.timeMs}:${event.uncertaintyMs?.startMs}:${event.uncertaintyMs?.endMs}`} event={event} onChange={value => onUncertainty(event.id, value)} />)}
  </details>;
}
