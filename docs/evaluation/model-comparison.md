# Choosing the classifier: six candidates, measured

The instruction was to find the strongest Arabic multi-dialect sentiment model,
prove it beats the one in use, and deploy it. Six were tested. **None proved
superior, and the model the earlier research recommended is measurably worse.**
The one in use stays. This is what the measurement says and why.

## The golden set

All 313 audience comments collected from the channel — the population, not a
sample, so there is no sampling error to report. Labelled by hand from the text
alone, with no model prediction visible, under one rule: the sentiment the text
expresses, not the commenter's stance toward the channel.

| label | count |
|---|---|
| negative | 164 |
| neutral | 69 |
| positive | 62 |
| mixed | 13 |
| unclear | 5 (excluded from scoring) |

**The limit of this set, stated plainly:** one annotator, no second pass, no
adjudication. Inter-annotator agreement is unmeasured, so the figures below
separate models from each other far better than they establish any model's
absolute accuracy. A second labeller is the cheapest next improvement.

Labels are committed as `row_id,label`. The comment text is not: it belongs to
people who are not the customer.

## Results

308 rows scored (313 less 5 unclear). 295 rows for the three-class comparison
(less the 13 mixed, which three-class models cannot express).

| model | macro F1 (4 classes) | macro F1 (3 classes) | accuracy (3) | mixed F1 |
|---|---|---|---|---|
| CAMeLBERT-DA **(in use)** | 0.5228 | 0.7079 | 0.759 | 0.000 |
| CAMeLBERT-Mix | 0.5235 | 0.7119 | 0.749 | 0.000 |
| CAMeLBERT-MSA | 0.5184 | 0.7026 | 0.763 | 0.000 |
| MARBERT (sentiment) | 0.4536 | 0.6164 | 0.603 | 0.000 |
| MARBERT (tweet) | 0.5374 | 0.7296 | 0.770 | 0.000 |
| AraBERT 4-class | **0.5883** | 0.6930 | 0.749 | 0.300 |

McNemar, paired on identical rows, against the model in use:

| candidate | p | verdict |
|---|---|---|
| CAMeLBERT-Mix | 0.76 | not separable |
| CAMeLBERT-MSA | 1.00 | not separable |
| MARBERT (sentiment) | **0.0001** | **worse** |
| MARBERT (tweet) | 0.78 | not separable |
| AraBERT 4-class | 1.00 | not separable |

## What this means

**MARBERT is the finding.** The market research recommended MARBERTv2, and on
this channel a MARBERT sentiment checkpoint is significantly worse than what is
already deployed — p = 0.0001, accuracy 0.60 against 0.76. It labels 165 of 295
comments neutral where only 69 are, collapsing the distinction a customer pays
for. The second MARBERT checkpoint, fine-tuned on tweets, is fine — so this is
about one checkpoint rather than the family, and neither beats the incumbent.

**Nothing else separates.** The three CAMeL variants and the tweet-tuned MARBERT
sit within 0.02 macro F1 of each other with p between 0.63 and 1.00. Swapping on
that evidence would re-analyse every stored comment under a new analysis key in
exchange for noise.

**AraBERT's higher 4-class macro F1 does not survive inspection.** It leads on
that column only because it is the one candidate with a Mixed class. Its
accuracy against the incumbent is *exactly* tied — 26 rows each side, p = 1.00 —
and it is worse on positive (0.750 against 0.791) and neutral (0.475 against
0.492). Its Mixed detector finds 3 of 13 at 43% precision. A coin-flip detector
for 4% of comments is not a proven improvement.

**No candidate meets the project's own gate.** The scorer's gate is macro F1
≥ 0.75. The best four-class result is 0.588 and the best three-class result is
0.730. Every model here labels roughly three comments in four correctly and is
weakest exactly where nuance lives: neutral F1 ranges 0.47–0.53 across all six.

**The incumbent over-reports negativity.** It predicts negative on 192 of 308
rows where 164 are negative — about 17% inflation. Read the negative share as
an upper bound.

## What would actually move this

1. **A second annotator**, to put a number on the ceiling these comparisons are
   measured against.
2. **Fine-tuning on this channel's own labelled data.** The golden set is 313
   rows; a few thousand would make this worth doing, and it is the only route
   that targets the neutral class where every off-the-shelf model is weak.
3. **Deciding what Mixed is for.** Four of the six models cannot express it and
   the fifth is poor at it. It may belong to human correction only.

## Reproducing

```sh
# per candidate, on a host with the inference extra installed
python -m labelling.predict_cli --texts texts.csv --model <name> --out pred.csv
npm run label:score -- --gold gold.csv --predictions pred.csv --key key.csv
```

Candidate names, pinned revisions and declared label mappings are in
`workers/python/src/sentiment/transformer.py`. Each mapping was read from that
commit's own `config.json` and is verified against the checkpoint at load time —
the six do not agree about label order, and reading one with another's order
would invert its verdicts silently.
