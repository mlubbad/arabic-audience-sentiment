import { useState } from "react";
import { Link } from "react-router";
import "./audience.css";
import type { Locale } from "../locale";
import { useStrings } from "../strings";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs";
import { useReveal } from "./useReveal";

type Who = "creator" | "agency";

export function Audience({ locale }: { locale: Locale }) {
  const S = useStrings(locale);
  const ref = useReveal<HTMLElement>();
  const [who, setWho] = useState<Who>("creator");
  const panels: Record<
    Who,
    {
      eyebrow: string;
      title: string;
      text: string;
      tags: ReadonlyArray<string>;
      space: string;
    }
  > = {
    creator: {
      eyebrow: S.lpForYou,
      title: S.lpCreatorTitle,
      text: S.lpCreatorText,
      tags: S.lpCreatorTags,
      space: S.lpYourChannelSpace,
    },
    agency: {
      eyebrow: S.lpForTeam,
      title: S.lpAgencyTitle,
      text: S.lpAgencyText,
      tags: S.lpAgencyTags,
      space: S.lpClientSpace,
    },
  };
  const panel = (k: Who) => {
    const p = panels[k];
    return (
      <TabsContent value={k} className="lp-audience-panel">
        <div className="lp-audience-copy">
          <Badge tone="neutral" className="lp-eyebrow">
            {p.eyebrow}
          </Badge>
          <h3>{p.title}</h3>
          <p>{p.text}</p>
          <div className="lp-tags">
            {p.tags.map((tag) => (
              <Badge key={tag} tone="neutral">
                ✓ {tag}
              </Badge>
            ))}
          </div>
          <Button asChild variant="ghost">
            <Link to="/dashboard">
              {S.lpExploreWork} <span aria-hidden="true">{S.arrowForward}</span>
            </Link>
          </Button>
        </div>
        <Card className="lp-workspace-window" aria-hidden="true">
          <span className="pw-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="lp-mini-label">{p.space}</span>
          <div className="lp-video-row">
            <div>
              <b>{S.lpVideoRow}</b>
              <i />
            </div>
          </div>
          <div className="lp-mini-bars">
            {[42, 76, 58, 92, 67, 84, 100].map((h, i) => (
              <i key={i} style={{ height: `${h}%` }} />
            ))}
          </div>
          <div className="lp-window-note">
            {S.lpWindowNote} <span>✓</span>
          </div>
          <span className="lp-caption">{S.lpArtCaption}</span>
        </Card>
      </TabsContent>
    );
  };
  return (
    <section
      ref={ref}
      className="lp-section lp-audience"
      aria-labelledby="audience-title"
    >
      <div className="lp-container">
        <div className="lp-section-head">
          <Badge tone="neutral" className="lp-eyebrow">
            {S.lpAudienceEyebrow}
          </Badge>
          <h2 id="audience-title">
            {S.lpAudienceLine1}
            <br />
            {S.lpAudienceLine2}
          </h2>
        </div>
        <Tabs value={who} onValueChange={(v) => setWho(v as Who)}>
          <TabsList
            aria-label={S.lpAudienceTabsLabel}
            className="lp-audience-tabs"
          >
            <TabsTrigger value="creator">{S.lpCreators}</TabsTrigger>
            <TabsTrigger value="agency">{S.lpAgencies}</TabsTrigger>
          </TabsList>
          {panel("creator")}
          {panel("agency")}
        </Tabs>
      </div>
    </section>
  );
}
