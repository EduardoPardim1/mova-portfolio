import { jsPDF } from "jspdf";
import type { SavedReport } from "./model";

/** Immutable renderer v1. Future layout changes must use a new report version. */
export function renderReportV1(report:SavedReport):Uint8Array {
 const s=report.snapshot,m=s.metrics,q=m.quality;
 const doc=new jsPDF({compress:true});
 doc.setFileId(report.id.replaceAll("-","").toUpperCase());
 const stamp=new Date(report.generated_at).toISOString().replace(/[-:TZ.]/g,"").slice(0,14);
 doc.setCreationDate(`D:${stamp}+00'00'`);
 doc.setProperties({title:"MOVA - Relatório de avaliação da marcha",author:"MOVA",creator:"MOVA report v1"});
 let y=22, escapedCharacters=false;
 const clean=(v:string)=>v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,"").replace(/[^\u0020-\u00ff\n\t]/gu,char=>{escapedCharacters=true;return `[U+${char.codePointAt(0)!.toString(16).toUpperCase()}]`});
 function line(value:string,size=10,bold=false){doc.setFont("helvetica",bold?"bold":"normal");doc.setFontSize(size);
  const lines=doc.splitTextToSize(clean(value),174) as string[];
  for(const item of lines){if(y>272){doc.addPage();y=22}doc.text(item,18,y);y+=size*0.46+1.4}y+=2;
 }
 const section=(title:string)=>{y+=3;doc.setTextColor(11,128,120);line(title,12,true);doc.setTextColor(25,40,50)};
 const val=(n:number|null,unit="")=>n===null?"Não disponível":`${n.toLocaleString("pt-BR",{maximumFractionDigits:2})}${unit}`;
 const date=(v:string)=>new Date(v).toLocaleString("pt-BR",{timeZone:"UTC"})+" UTC";
 doc.setTextColor(11,128,120);line("MOVA",24,true);doc.setTextColor(25,40,50);line("Relatório de avaliação da marcha",16,true);
 line("Indicadores experimentais. Não constituem diagnóstico ou validação clínica.",10);
 section("Identificação");line(`Paciente: ${s.patient.name}`);line(`Nascimento: ${s.patient.birth_date??"Não informado"} | Sexo: ${{female:"Feminino",male:"Masculino",other:"Outro",not_informed:"Não informado"}[s.patient.sex??""]??"Não informado"}`);
 line(`Organização: ${s.organization.name}`);line(`Gerado por: ${s.generator.name}`);
 line(`Profissional da avaliação: ${s.assessment.professional_id===s.generator.id?s.generator.name:s.assessment.professional_id}`);
 line(`Avaliação: ${s.assessment.id}`,9);line(`Data da avaliação: ${date(s.assessment.created_at)}`);line(`Gerado em: ${date(report.generated_at)}`);
 line(`Relatório: ${report.id} | Versão: ${report.report_version}`,8);
 section("Protocolo e resultados registrados");line(`Protocolo: ${s.assessment.protocol==="walk_10m"?"Caminhada de 10 metros":"Registro de marcha em vídeo"}`);
 line(`Versão do cálculo: ${s.assessment.algorithm_version??"Não registrada"}`);
 for(const [label,value] of [["Duração",val(m.duration_seconds," s")],["Passos estimados",val(m.estimated_steps)],["Cadência estimada",val(m.cadence_spm," passos/min")],["Velocidade estimada",val(m.speed_mps," m/s")],["Regularidade temporal",val(q.step_regularity,"%")],["Simetria temporal",val(q.temporal_symmetry,"%")],["Qualidade da pose",q.level??"Não disponível"],["Quadros úteis",`${val(q.usable_frames)} / ${val(q.total_frames)}`],["Cobertura de detecção",val(q.detection_rate===null?null:q.detection_rate*100,"%")]])line(`${label}: ${value}`);
 section("Observações profissionais");line(s.assessment.notes||"Não registradas.");section("Limitações");line(m.limitations||"Limitações específicas não registradas.");
 line("Eventos são estimativas heurísticas, não contatos de solo validados. Este documento preserva os dados disponíveis no momento da geração; não representa revisão clínica automática.");
 line("Séries temporais, gráficos e ângulos não persistidos não são reconstruídos neste relatório. Campos ausentes permanecem indisponíveis.");
 if(escapedCharacters)line("Caracteres fora da fonte são preservados como códigos [U+...]; o snapshot mantém o texto original.",8);
 for(let page=1;page<=doc.getNumberOfPages();page++){doc.setPage(page);doc.setFontSize(8);doc.setTextColor(90);doc.text(`MOVA | Documento confidencial | ${page}/${doc.getNumberOfPages()}`,18,286)}
 return new Uint8Array(doc.output("arraybuffer"));
}
