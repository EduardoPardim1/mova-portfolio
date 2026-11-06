# Decisão final — desenvolvimento do motor suspenso

A engenharia de software foi preservada, mas não foi demonstrada precisão suficiente para uso clínico. A decisão é suspender o desenvolvimento do motor automático, sem novas rodadas de algoritmos ou treinamento.

## Evidências preservadas em forma agregada

- MOVA, MyoGait Heavy, MyoGait Lite e VideoGait concluíram 44/44 gravações originais laterais do GaHu-Video V2, totalizando 176 execuções em 44 participantes.
- Candidatos por método: MOVA 963; Heavy 1.643; Lite 2.131; VideoGait 587. O MOVA se absteve de cadência em 44/44.
- Não foram obtidas referências independentes suficientes de contato inicial por pé para pontuar essa amostra. Não se pode chamar os candidatos de contatos verdadeiros ou os vídeos de clinicamente validados.
- IntellEvent foi testado em dois vídeos de desenvolvimento com cinco contatos anotados cada. A ±100 ms: 4 TP, 8 FP e 6 FN; precisão 33,3%, recall 40%, F1 36,4%. Os quatro pares temporalmente correspondentes tinham o lado esperado. Isso não prova acerto de lateralidade nos eventos restantes.
- Sensibilidade: a ±150 ms, 5 TP/7 FP/5 FN; a ±200 ms, 6 TP/6 FP/4 FN. O critério principal permaneceu ±100 ms.

## Limitações

Os dois vídeos anotados eram de desenvolvimento, com um avaliador; uma anotação foi realizada após conhecimento da contagem automática. Não são validação independente. Os 44 participantes laterais têm processamento comprovado, mas não referência independente de eventos. Não se validaram velocidade calibrada, toe-off, duração automática da caminhada nem transferência para outras populações.

Os critérios anteriores incluíam precisão/recall de 90% a ±100 ms, lateralidade de 95%, erro temporal mediano até 60 ms e erro de cadência até 5 passos/min e 5%. Nenhum método demonstrou atender esse conjunto em vídeos independentes com referência adequada. Ausência de referência no GaHu é resultado inconclusivo sobre precisão, não prova de falha em todos os vídeos laterais.

## Fontes e reprodução

[GaHu-Video V2](https://data.mendeley.com/datasets/gprg4s73v4/2), [MyoGait](https://github.com/IDMDataHub/myogait) e [IntellEvent](https://github.com/fhstp/IntellEvent) são fontes da investigação anterior. Mencionar uma fonte não concede direitos sobre seus vídeos ou modelos. Nenhum desses materiais é redistribuído aqui.

Esta edição publica as conclusões agregadas e a lógica de comparação; não permite reproduzir os números de vídeo sem os dados e ambientes originais preservados privadamente. `npm run test:python` reproduz somente os testes sintéticos de software. Nenhum novo experimento foi executado para a publicação.
