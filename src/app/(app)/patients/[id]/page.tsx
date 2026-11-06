"use client";

import Link from "next/link";
import { ReportPanel } from "@/components/reports/report-panel";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Patient = { id: string; full_name: string; birth_date: string | null; sex: string; phone: string | null; notes: string | null; created_at: string };
type Quality = { level?: string; mean_visibility?: number | null; usable_frames?: number; total_frames?: number; step_regularity?: number | null; temporal_symmetry?: number | null };
type Metric = { duration_seconds: number | null; estimated_steps: number | null; cadence_spm: number | null; speed_mps: number | null; quality: Quality | null; limitations: string | null };
type Assessment = { id: string; protocol: "walk_10m" | "gait_video"; created_at: string; algorithm_version: string | null; notes: string | null; status: string; gait_metrics: Metric[] };

const sexLabel: Record<string, string> = { female: "Feminino", male: "Masculino", other: "Outro", not_informed: "Não informado" };
const protocolLabel: Record<string, string> = { walk_10m: "Teste de caminhada de 10 metros", gait_video: "Registro de marcha em vídeo" };
const formatDate = (value: string) => new Date(value).toLocaleString("pt-BR");
const value = (item: number | null | undefined, unit = "") => item === null || item === undefined ? "Não disponível" : `${Number(item).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}${unit}`;

async function responseMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : fallback;
}

export default function PatientRecord() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const patientId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [patient, setPatient] = useState<Patient | null>(null);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [message, setMessage] = useState("Carregando prontuário…");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedAssessment, setSelectedAssessment] = useState<string | null>(null);

  async function load() {
    try {
      const [patientResponse, historyResponse] = await Promise.all([fetch(`/api/patients/${patientId}`, { cache: "no-store" }), fetch(`/api/patients/${patientId}/assessments`, { cache: "no-store" })]);
      if (!patientResponse.ok) { setMessage(await responseMessage(patientResponse, "Não foi possível carregar o prontuário.")); return; }
      const patientBody = await patientResponse.json();
      setPatient(patientBody.data);
      if (!historyResponse.ok) { setMessage(`Prontuário carregado, mas o histórico não está disponível: ${await responseMessage(historyResponse, "erro desconhecido")}`); return; }
      const historyBody = await historyResponse.json();
      setAssessments(historyBody.data ?? []);
      setMessage("");
    } catch {
      setMessage("Falha de rede ao carregar o prontuário. Confirme que o servidor local está ativo.");
    }
  }

  useEffect(() => { if (patientId) void load(); }, [patientId]);

  const comparable = useMemo(() => {
    const groups = assessments.reduce<Record<string, Assessment[]>>((result, assessment) => { (result[assessment.protocol] ??= []).push(assessment); return result; }, {});
    return Object.values(groups).find((group) => group.length >= 2) ?? [];
  }, [assessments]);
  const chartData = useMemo(() => [...comparable].reverse().map((assessment) => { const metric = assessment.gait_metrics[0]; return { date: new Date(assessment.created_at).toLocaleDateString("pt-BR"), cadence: metric?.cadence_spm ?? null, steps: metric?.estimated_steps ?? null }; }), [comparable]);

  async function save() {
    if (!patient) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/patients/${patient.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: patient.full_name, birthDate: patient.birth_date ?? "", sex: patient.sex, phone: patient.phone ?? "", notes: patient.notes ?? "" }) });
      if (!response.ok) { setMessage(await responseMessage(response, "Não foi possível atualizar o paciente.")); return; }
      const body = await response.json();
      setPatient(body.data);
      setEditing(false);
      setMessage("Paciente atualizado com sucesso.");
    } catch { setMessage("Falha de rede ao atualizar o paciente."); } finally { setSaving(false); }
  }

  if (!patient) return <><Link className="button secondary" href="/patients">Voltar para pacientes</Link><p className="notice" aria-live="polite">{message}</p></>;

  return <><div className="topline"><div><span className="eyebrow">Prontuário individual</span><h1>{patient.full_name}</h1><p className="muted">Cadastro em {formatDate(patient.created_at)}</p></div><div className="actions"><Link className="button primary" href={`/assessments/new?patientId=${encodeURIComponent(patient.id)}`}>Nova avaliação</Link><button className="button secondary" type="button" onClick={() => setEditing((current) => !current)}>{editing ? "Cancelar edição" : "Editar paciente"}</button></div></div>
    <section className="card"><h2>Dados do paciente</h2>{editing ? <><label className="label" htmlFor="patient-name">Nome completo</label><input id="patient-name" className="field" value={patient.full_name} onChange={(event) => setPatient({ ...patient, full_name: event.target.value })} maxLength={120} /><label className="label" htmlFor="patient-birth-date">Data de nascimento</label><input id="patient-birth-date" className="field" type="date" value={patient.birth_date ?? ""} onChange={(event) => setPatient({ ...patient, birth_date: event.target.value || null })} /><label className="label" htmlFor="patient-sex">Sexo</label><select id="patient-sex" className="field" value={patient.sex} onChange={(event) => setPatient({ ...patient, sex: event.target.value })}><option value="not_informed">Não informado</option><option value="female">Feminino</option><option value="male">Masculino</option><option value="other">Outro</option></select><label className="label" htmlFor="patient-phone">Telefone</label><input id="patient-phone" className="field" value={patient.phone ?? ""} onChange={(event) => setPatient({ ...patient, phone: event.target.value || null })} maxLength={25} /><label className="label" htmlFor="patient-notes">Observações</label><textarea id="patient-notes" className="field" value={patient.notes ?? ""} onChange={(event) => setPatient({ ...patient, notes: event.target.value || null })} maxLength={2000} /><button className="button primary" type="button" disabled={saving} onClick={() => void save()}>{saving ? "Salvando…" : "Salvar alterações"}</button></> : <dl style={{ display: "grid", gridTemplateColumns: "minmax(140px, 220px) 1fr", gap: "10px 16px" }}><dt className="muted">Data de nascimento</dt><dd>{patient.birth_date ? new Date(`${patient.birth_date}T00:00:00`).toLocaleDateString("pt-BR") : "Não informada"}</dd><dt className="muted">Sexo</dt><dd>{sexLabel[patient.sex] ?? "Não informado"}</dd><dt className="muted">Telefone</dt><dd>{patient.phone || "Não informado"}</dd><dt className="muted">Observações</dt><dd style={{ whiteSpace: "pre-wrap" }}>{patient.notes || "Não informadas"}</dd></dl>}</section>
    {message && <p className="notice" aria-live="polite">{message}</p>}
    <section className="card" style={{ marginTop: 20 }}><h2>Histórico de avaliações</h2>{!assessments.length ? <p className="muted">Nenhuma avaliação registrada para este paciente.</p> : <div style={{ display: "grid", gap: 12 }}>{assessments.map((assessment) => { const metric = assessment.gait_metrics[0]; const expanded = selectedAssessment === assessment.id; const quality = metric?.quality; return <article key={assessment.id} style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14 }}><div className="topline"><div><b>{protocolLabel[assessment.protocol]}</b><br /><small className="muted">{formatDate(assessment.created_at)}</small></div><button className="button secondary" type="button" onClick={() => setSelectedAssessment(expanded ? null : assessment.id)}>{expanded ? "Fechar detalhes" : "Ver detalhes"}</button></div><div className="stats"><article className="stat"><small>Passos estimados</small><b>{value(metric?.estimated_steps)}</b></article><article className="stat"><small>Cadência estimada</small><b>{value(metric?.cadence_spm, " spm")}</b></article><article className="stat"><small>Regularidade temporal</small><b>{value(quality?.step_regularity, "%")}</b><small className="muted">{quality?.step_regularity === undefined ? "Não registrada nesta avaliação" : "Intervalos entre passos"}</small></article><article className="stat"><small>Qualidade da detecção</small><b>{quality?.level ?? "Não disponível"}</b><small className="muted">{quality?.usable_frames !== undefined && quality?.total_frames !== undefined ? `${quality.usable_frames}/${quality.total_frames} quadros úteis` : "Sem contagem registrada"}</small></article></div>{expanded && <div className="notice"><p><b>Velocidade estimada:</b> {value(metric?.speed_mps, " m/s")}</p><p><b>Duração:</b> {value(metric?.duration_seconds, " s")}</p><p><b>Visibilidade média:</b> {quality?.mean_visibility === null || quality?.mean_visibility === undefined ? "Não disponível" : `${Math.round(quality.mean_visibility * 100)}%`}</p><p><b>Simetria temporal:</b> {value(quality?.temporal_symmetry, "%")}</p><p><b>Indicadores e limitações:</b> {metric?.limitations || "Não registrados"}</p>{assessment.notes && <p><b>Observações profissionais:</b> {assessment.notes}</p>}<p className="muted">Indicadores experimentais: não constituem diagnóstico nem validação clínica.</p><ReportPanel assessmentId={assessment.id}/></div>}</article>; })}</div>}</section>
    {comparable.length >= 2 && <section className="card" style={{ marginTop: 20 }}><h2>Evolução entre avaliações comparáveis</h2><p className="muted">Comparação de {protocolLabel[comparable[0].protocol]} por data. O MOVA não classifica automaticamente os resultados como melhora ou piora clínica.</p><div style={{ height: 280 }}><ResponsiveContainer><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis /><Tooltip /><Line type="monotone" dataKey="cadence" name="Cadência estimada" stroke="#0b8078" connectNulls /><Line type="monotone" dataKey="steps" name="Passos estimados" stroke="#184a7a" connectNulls /></LineChart></ResponsiveContainer></div></section>}
    <button className="button secondary" type="button" style={{ marginTop: 20 }} onClick={() => router.push("/patients")}>Voltar para pacientes</button>
  </>;
}
