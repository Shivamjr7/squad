import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getMostRecentCircleSlug, requireDisplayNameSet } from "@/lib/auth";
import { LandingNav } from "@/components/landing/nav";
import { LandingHero } from "@/components/landing/hero";
import { LandingSocialProof } from "@/components/landing/social-proof";
import { LandingProblem } from "@/components/landing/problem";
import { LandingHowItWorks } from "@/components/landing/how-it-works";
import { LandingPlanCardExplainer } from "@/components/landing/plan-card-explainer";
import { LandingFeatureGrid } from "@/components/landing/feature-grid";
import { LandingStatsTestimonial } from "@/components/landing/stats-testimonial";
import { LandingFinalCta } from "@/components/landing/final-cta";
import { LandingFooter } from "@/components/landing/footer";

export default async function Home() {
  const { userId } = await auth();

  if (userId) {
    await requireDisplayNameSet(userId);
    const slug = await getMostRecentCircleSlug(userId);
    if (slug) {
      redirect(`/c/${slug}`);
    }
    redirect("/onboarding");
  }

  return (
    <>
      <LandingNav />
      <main className="flex flex-col">
        <LandingHero />
        <LandingSocialProof />
        <LandingProblem />
        <LandingHowItWorks />
        <LandingPlanCardExplainer />
        <LandingFeatureGrid />
        <LandingStatsTestimonial />
        <LandingFinalCta />
      </main>
      <LandingFooter />
    </>
  );
}
