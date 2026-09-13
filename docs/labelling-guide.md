# Labelling guide — the human evaluation set

Read this before labelling anything. It is short on purpose.

Nothing in this project claims an accuracy figure, and nothing will until this set
exists. That makes these ~600 judgements the most load-bearing data in the build:
every later claim about how well the model works rests on them, and a model cannot
be measured against labels it helped produce.

## What you will be given

| File | Who holds it |
| --- | --- |
| `estimate-sheet.csv` | The labellers |
| `booster-sheet.csv` | The labellers |
| `key.csv` | Us — not circulated with the sheets |
| `manifest.json` | Us — records the seed, so any round can be redrawn exactly |

The sheets carry `row_id`, `context`, `text`, and three empty columns for you to
fill: `label`, `confidence`, `notes`. They deliberately do **not** carry the model's
prediction, any existing label, the author, the like count, or the video. A labeller
who can see the model's answer is no longer an independent measurement of it, and one
who can see the like count is being told which comments are supposed to matter.

Open them in Excel or Sheets. They are UTF-8 with a BOM so Arabic opens as Arabic.

## The labels

Five values. Use exactly these strings.

| Label | Use when |
| --- | --- |
| `positive` | The comment expresses approval, praise, thanks, or satisfaction. |
| `negative` | It expresses criticism, complaint, anger, or disappointment. |
| `neutral` | It carries no evaluation: a question, a fact, a timestamp, a greeting. |
| `mixed` | It carries **both** a positive and a negative evaluation. |
| `unclear` | You genuinely cannot tell. |

**`neutral` is not a fallback.** It means you read an evaluation-free comment, not
that you could not decide. When you cannot decide, the answer is `unclear`. A forced
choice turns "I cannot tell" into noise that looks like a judgement, and that noise
becomes the model's apparent error.

**`mixed` is a real class, not a bin for hard cases.** It applies when both polarities
are present about the subject — most often around a contrastive marker: *لكن، بس، رغم،
مع ذلك*. "الإخراج جميل لكن الصوت سيئ" is `mixed`. A comment you find difficult but
which only praises is still `positive`.

The `booster-sheet.csv` is full of contrastive markers by design, so expect far more
`mixed` there than in the estimate sheet. That is the point of it, and it is why its
results are never pooled into the headline figure.

## Judging, specifically

- **Label the sentiment expressed, not whether you agree with it**, and not whether
  the comment is polite. "هذا الفيديو كاذب تماماً" is `negative` regardless of who is
  right.
- **Sentiment about the content, not about the world.** "الوضع في غزة مأساوي" reacting
  to a report is `negative` about the situation, not about the video. Label the
  sentiment the comment expresses; note in `notes` when the target is ambiguous.
- **Sarcasm counts as what it means, not what it says.** "شكراً على إضاعة وقتي" is
  `negative`.
- **A reply comes with its `context` column** — the comment it answers. Read it. "لا
  أوافق" is not sentiment about anything until you know what it answers.
- **Emoji carry sentiment.** A comment that is only 😂 or only 🔥 is labellable. A
  comment that is only a timestamp or only "🙏" as a greeting is `neutral`.
- **Dialect, MSA, Arabizi and code-switching are all in scope.** Do not mark a comment
  `unclear` because it is written in Latin letters or in a dialect you read slowly.
  Mark it `unclear` only when its meaning is genuinely opaque to you.
- **`confidence`**: `3` sure, `2` fairly sure, `1` a guess. Low-confidence rows are
  analysed separately — they are not discarded, and they are not held against you.
- **`notes`**: anything that made the call hard. These are read.

## How the two sheets differ, and why it matters

`estimate-sheet.csv` is a proportionally stratified random sample. Its selection does
not depend on what any comment says, so it is the **only** file an accuracy figure may
be computed from.

`booster-sheet.csv` over-selects comments containing contrastive markers, because
`mixed` is rare and a uniform sample of a corpus that is mostly short praise contains
almost none of it. It exists so the rare class can be studied and so a model can be
chosen between. **Selecting on content and then measuring accuracy over the result
reports the sample, not the corpus** — so booster rows never enter the headline number
without explicit reweighting, and the key file records which set every row came from.

## Independence and agreement

- Label on your own. Do not discuss items with another labeller while labelling.
- **Preferred**: two labellers independently label every row, and disagreements go to a
  third person for adjudication. That yields both a cleaner set and an agreement figure.
- **Minimum**: one labeller per row, plus a shared 150-row overlap block labelled by
  everyone, which is enough to estimate agreement.

Report Cohen's kappa for two labellers, Fleiss' for more. Below roughly 0.6 the label
definitions are the problem, not the labellers — stop, fix the guide, and relabel.
**An agreement figure is not optional**: without it there is no way to separate model
error from label noise, and every accuracy claim inherits that ambiguity.

## Scoring: macro F1, not accuracy

```bash
npm run label:score -- --gold round-1/estimate-sheet.csv \
  --predictions round-1/model-a.csv --key round-1/key.csv --gate 0.75
```

**The headline is macro F1. Accuracy never decides this**, and the difference is the whole
point of the exercise.

A model can reach 0.80 accuracy on a corpus that is mostly praise while never once
identifying a negative comment. Accuracy calls that a good model. Macro F1 does not,
because every class weighs the same however rare it is — and negative is precisely what a
customer pays to find. The candidate model this project started from reports exactly that
shape: accuracy 0.80, macro F1 0.65.

The scorer therefore:

- averages over **every class the gold set contains**, including one the model never
  predicts, which scores zero rather than vanishing from the average;
- excludes `unclear` and unanalysable rows from the ratio and reports them as **coverage**,
  because a human who could not tell is not evidence about the model;
- reports rows it could not score rather than quietly scoring the rest — a model that fails
  on a third of the set and is measured on the remainder is being measured on the part it
  found easy;
- gives a Wilson interval, which stays inside 0 and 1 where the textbook approximation
  does not, and a rare class lands exactly there.

It exits non-zero below the gate, so it can sit in a pipeline and mean something.

## Using the result honestly

- **The gate is macro F1 ≥ 0.75 on the estimate set.** Below it, fine-tune before building
  anything on top; above it, proceed and keep the set frozen for every later version.
- Choose between candidate models on the **booster** set and any development slice. Then
  report the **estimate** figure once, for the chosen model. Selecting a model on the same
  data you report is how a number ends up unreproducible.
- At n = 400 the 95% interval is roughly ±5 percentage points; at n = 600, ±4. Report the
  interval, not just the point.
- Per-class figures from the estimate set alone will be wide for `mixed`. Say so rather
  than quoting a precise-looking number from a handful of rows.
- The sheets are drawn over *unique* texts: identical duplicates collapse, and `key.csv`
  records how many collapsed into each row. The default figure is therefore computed over
  unique comment texts. Weight by `duplicates` if the question is instead about the raw
  comment stream.
- Without a second labeller, kappa is unmeasured and every figure inherits that ambiguity.
  The scorer says so in its output rather than staying silent.

## Redrawing a round

Every round is reproducible from its seed:

```bash
npm run label:draw -- --corpus raw-data/corpus.json --out labelling/round-1 --seed 1337
```

The corpus is a JSON file with a `comments` array in the dashboard's shape. `manifest.json`
records the seed, the eligible population, how many duplicates collapsed, what was excluded
and why, and any shortfall against the requested size — so a round that came out smaller
than planned is visible rather than silently changing the confidence interval.
