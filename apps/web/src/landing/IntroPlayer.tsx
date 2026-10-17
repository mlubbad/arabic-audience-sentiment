import "./intro.css";
import type { Locale } from "../locale";
import { useStrings } from "../strings";
import { numerals } from "./demoData";
import { IntroScene } from "./IntroScenes";
import { useIntroPlayer } from "./useIntroPlayer";

/* Two-digit ordinals ("01", "٠١") for the scene tags. */
const ordinals: Record<Locale, Intl.NumberFormat> = {
  ar: new Intl.NumberFormat("ar", {
    numberingSystem: "arab",
    minimumIntegerDigits: 2,
  }),
  en: new Intl.NumberFormat("en", { minimumIntegerDigits: 2 }),
};

/** The product in twenty seconds, as the hero's picture: four five-second
 *  scenes on a dark stage — collect, understand, compare, decide — with a
 *  progress bar per scene. The stage is a moving picture inside the hero's
 *  figure, captioned with the sentence the keyword map keeps there; the list
 *  under it carries the same four steps as text, is what assistive
 *  technology and search engines read, and is how a reader jumps to a
 *  scene. */
export function IntroPlayer({ locale }: { locale: Locale }) {
  const S = useStrings(locale);
  const scenes = [
    {
      tag: S.lpIntroScene1Tag,
      title: S.lpIntroScene1Title,
      text: S.lpIntroScene1,
    },
    {
      tag: S.lpIntroScene2Tag,
      title: S.lpIntroScene2Title,
      text: S.lpIntroScene2,
    },
    {
      tag: S.lpIntroScene3Tag,
      title: S.lpIntroScene3Title,
      text: S.lpIntroScene3,
    },
    {
      tag: S.lpIntroScene4Tag,
      title: S.lpIntroScene4Title,
      text: S.lpIntroScene4,
    },
  ];
  const player = useIntroPlayer<HTMLDivElement>(scenes.length);
  const { index } = player;
  const active = scenes[index] ?? scenes[0]!;
  const total = numerals[locale].format(scenes.length);
  return (
    <>
      {/* The sentence that was the hero illustration's alt is a place in
          the keyword map; it stays as the figure's caption, read and
          indexed, unseen. */}
      <figure className="lp-hero-figure">
        <span className="lp-hero-halo" aria-hidden="true" />
        <div
          ref={player.ref}
          className="ix-player"
          data-playing={player.playing ? "true" : "false"}
          data-fresh={player.fresh ? "" : undefined}
          data-testid="intro-player"
        >
          <div className="ix-stage" aria-hidden="true">
            <span className="ix-glow ix-glow--a" />
            <span className="ix-glow ix-glow--b" />
            <div className="ix-top">
              <span className="ix-live">
                <i /> {S.lpIntroPreview}
              </span>
              <span className="ix-meta">{S.lpIntroMeta}</span>
            </div>
            <IntroScene
              key={index}
              index={index}
              ordinal={ordinals[locale].format(index + 1)}
              tag={active.tag}
              title={active.title}
              locale={locale}
            />
            <div className="ix-progress">
              {scenes.map((s, i) => (
                <span
                  key={s.tag}
                  className={
                    i < index ? "is-done" : i === index ? "is-on" : undefined
                  }
                >
                  {/* The active bar is the clock: its fill is a five-second
                      CSS animation, paused with the player, and its end
                      moves the story on. Keyed by scene so a jump restarts
                      it from zero. */}
                  <i
                    key={i === index ? `on-${index}` : "off"}
                    onAnimationEnd={
                      i === index
                        ? (e) => {
                            if (e.target === e.currentTarget) player.next();
                          }
                        : undefined
                    }
                  />
                </span>
              ))}
            </div>
          </div>
          {player.reduced ? null : (
            <button
              type="button"
              className="ix-toggle"
              onClick={player.toggle}
              aria-label={player.paused ? S.lpIntroPlay : S.lpIntroPause}
            >
              <span
                aria-hidden="true"
                className={player.paused ? "ix-icon-play" : "ix-icon-pause"}
              />
            </button>
          )}
        </div>
        <figcaption className="ui-sr-only">{S.lpHeroAlt}</figcaption>
      </figure>

      <ol className="ix-steps" aria-label={S.lpIntroScenesLabel}>
        {scenes.map((s, i) => (
          <li key={s.tag} className={i === index ? "ix-step is-on" : "ix-step"}>
            <span className="ix-step-tag">
              <b className="ui-num">{ordinals[locale].format(i + 1)}</b> {s.tag}
            </span>
            <h3>
              <button
                type="button"
                onClick={() => player.goTo(i)}
                aria-current={i === index ? "step" : undefined}
              >
                <span className="ui-sr-only">
                  {S.lpIntroSceneOf(numerals[locale].format(i + 1), total)}
                  {S.listSeparator}
                </span>
                {s.title}
              </button>
            </h3>
            <p>{s.text}</p>
          </li>
        ))}
      </ol>
    </>
  );
}
