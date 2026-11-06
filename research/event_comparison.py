"""Recorte das funções de comparação originais; sem dados, downloads ou modelos."""
import math
from types import MethodType
from functools import lru_cache

def match_events(human, predicted, tolerance_ms=100, require_side=False):
    """Máxima cardinalidade, depois menor erro; um-para-um, ordem temporal."""
    h = sorted(human, key=lambda e: e['timeMs'])
    p = sorted(predicted, key=lambda e: e['timeMs'])
    if tolerance_ms < 0 or not math.isfinite(tolerance_ms):
        raise ValueError('Tolerância inválida')
    for event in h + p:
        if not math.isfinite(event['timeMs']) or event['side'] not in ('left', 'right'):
            raise ValueError('Evento inválido')

    @lru_cache(None)
    def solve(i, j):
        if i == len(h) or j == len(p):
            return ()
        options = [solve(i + 1, j), solve(i, j + 1)]
        if abs(p[j]['timeMs'] - h[i]['timeMs']) <= tolerance_ms and (
            not require_side or h[i]['side'] == p[j]['side']
        ):
            options.append(((i, j),) + solve(i + 1, j + 1))
        return min(options, key=lambda pairs: (-len(pairs), sum(
            abs(p[b]['timeMs'] - h[a]['timeMs']) for a, b in pairs), pairs))

    pairs = solve(0, 0)
    matches = [dict(human=h[a], predicted=p[b],
                    errorMs=round(p[b]['timeMs'] - h[a]['timeMs'], 4),
                    sideCorrect=h[a]['side'] == p[b]['side']) for a, b in pairs]
    return matches, [p[j] for j in range(len(p)) if all(b != j for _, b in pairs)], [
        h[i] for i in range(len(h)) if all(a != i for a, _ in pairs)]

def anatomical_candidates(candidates, was_flipped):
    # MyoGait _flip_landmarks troca x e rótulos L/R para padronizar direção.
    # Desfazer somente essa troca conhecida, sem usar referências para escolher lado.
    return [dict(e,side=('right' if e['side']=='left' else 'left') if was_flipped else e['side'])
            for e in candidates]

def compare(reference, candidates, duration_ms, require_side=False):
    if reference.get('intervals'):
        raise ValueError('Referência com intervalos de incerteza exige protocolo próprio; não pontuar automaticamente')
    start = reference.get('walkingStartMs')
    end = reference.get('walkingEndMs')
    start = 0 if start is None else start
    end = duration_ms if end is None else end
    if not (0 <= start < end <= duration_ms + 1):
        raise ValueError('Intervalo de referência inválido')
    human = [{'timeMs': e['timeMs'], 'side': e['side']} for e in reference['events']
             if e['kind'] == 'initial_contact' and e['confidence'] == 'high'
             and e['side'] in ('left', 'right') and start <= e['timeMs'] <= end]
    uncertain = [e['timeMs'] for e in reference['events'] if
                 e['kind'] != 'initial_contact' or e['confidence'] != 'high'
                 or e['side'] not in ('left', 'right')]
    inside = [e for e in candidates if start <= e['timeMs'] <= end]
    matches, unmatched, missed = match_events(human, inside, require_side=require_side)
    # Não penaliza regiões sem referência confiável. Não apaga contatos confirmados.
    excluded = [e for e in unmatched if any(abs(e['timeMs']-t) <= 100 for t in uncertain)]
    fp = [e for e in unmatched if e not in excluded]
    tp, nfp, fn = len(matches), len(fp), len(missed)
    precision = tp / (tp+nfp) if tp+nfp else None
    recall = tp / (tp+fn) if tp+fn else None
    f1 = 2*tp/(2*tp+nfp+fn) if 2*tp+nfp+fn else None
    cadence = lambda ev: 60000*(len(ev)-1)/(ev[-1]['timeMs']-ev[0]['timeMs']) if (
        len(ev) >= 2 and ev[-1]['timeMs'] > ev[0]['timeMs']) else None
    return dict(windowMs=[start, end], toleranceMs=100, sideRequired=require_side,
                tp=tp, fp=nfp, fn=fn, precision=precision, recall=recall, f1=f1,
                sideCorrect=sum(m['sideCorrect'] for m in matches), matches=matches,
                falsePositives=fp, missedContacts=missed, excludedAmbiguous=excluded,
                outsideWindow=[e for e in candidates if e not in inside],
                humanCadenceSpm=cadence(sorted(human, key=lambda e:e['timeMs'])),
                candidateCadenceSpm=cadence(sorted(inside, key=lambda e:e['timeMs'])))

def virtual_hip(left, right):
    """Centro geométrico de quadris existentes; nenhum ponto clínico inferido."""
    if len(left) != len(right):
        raise ValueError('Quadris em timelines diferentes')
    result=[]
    for l,r in zip(left,right):
        if l is None or r is None or not all(v is not None and math.isfinite(v) for v in (*l,*r)):
            result.append(None)
        else:
            result.append(((l[0]+r[0])/2,(l[1]+r[1])/2,min(l[2],r[2])))
    return result

def install_hip_adapter(detector, loader=None):
    # Bug upstream: POSE_LANDMARKER não possui HIP. Uma lista de None passa
    # como centro válido; fallback também usa len(float) e retorna só 2 valores.
    if loader is None:
        from utils.data import get_keypoints
        loader=get_keypoints
    def get_hip(self,path):
        values,indices,offset=loader(path,self.skeleton,
            ['LEFT_HIP','RIGHT_HIP'],self.confidence_threshold)
        if not indices:
            return None,True,offset
        return virtual_hip(values['LEFT_HIP'],values['RIGHT_HIP']),True,offset
    detector._get_hip_reference_data=MethodType(get_hip,detector)
