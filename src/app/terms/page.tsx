import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Use | CWF.LOL",
};

export default function TermsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12 text-sm leading-6 text-slate-200">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-white">CWF.LOL — Terms of Use</h1>
        <p className="text-slate-300">Effective date: February 12, 2026</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">1) Acceptance</h2>
        <p>
          By accessing or using CWF.LOL (the “Service”), you agree to these
          Terms. If you do not agree, do not use the Service.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">2) What CWF.LOL Does</h2>
        <p>
          CWF.LOL lets users create and manage custom League of Legends
          leaderboards and clubs, and view player progress and match/stat
          summaries. The Service may also allow users to post content such as
          highlight links and tournament posts.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">3) Eligibility</h2>
        <p>
          You must be able to legally use the Service where you live. If you are
          under the age of majority in your location, you may only use the
          Service with a parent/guardian’s permission.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">4) Accounts and Security</h2>
        <p>
          You are responsible for activity under your account and for keeping
          your login method secure. You agree not to attempt to access accounts
          you do not own.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">
          5) User Content (Highlights, Posts, Links)
        </h2>
        <p>If you submit content to the Service (“User Content”), you:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>confirm you have the rights to post it; and</li>
          <li>
            grant CWF.LOL a non-exclusive, worldwide, royalty-free license to
            host, display, and distribute it only as needed to operate and
            promote the Service.
          </li>
        </ul>
        <p>
          We may remove User Content at any time if we believe it violates these
          Terms, the law, or another person’s rights.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">6) Rules of Conduct</h2>
        <p>You agree not to:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>break any law or violate others’ rights;</li>
          <li>harass, threaten, or impersonate others;</li>
          <li>upload malware or attempt to disrupt the Service;</li>
          <li>scrape the Service or misuse it in a way that harms performance;</li>
          <li>use the Service for gambling/betting functionality.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">
          7) Riot Games Notice (Required)
        </h2>
        <p>
          CWF.LOL is a third-party product and is not endorsed by Riot Games.
        </p>
        <p>
          CWF.LOL is not endorsed by Riot Games and does not reflect the views or
          opinions of Riot Games or anyone officially involved in producing or
          managing Riot Games properties. Riot Games and all associated
          properties are trademarks or registered trademarks of Riot Games, Inc.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">8) Third-Party Services</h2>
        <p>
          The Service may link to or rely on third-party services (e.g., login
          providers, hosting, analytics, payment processors). We are not
          responsible for third-party services.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">9) Disclaimers</h2>
        <p>
          The Service is provided “as is” and “as available.” We do not
          guarantee uptime, accuracy of data, or that the Service will be
          error-free.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">10) Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, CWF.LOL will not be liable for
          indirect, incidental, special, consequential, or punitive damages, or
          for lost profits, data, or goodwill.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">11) Termination</h2>
        <p>
          We may suspend or terminate access to the Service if you violate these
          Terms or if we reasonably believe your use creates risk or legal
          exposure.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">12) Changes to These Terms</h2>
        <p>
          We may update these Terms. Continued use of the Service after changes
          means you accept the updated Terms.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">13) Contact</h2>
        <p>Questions about these Terms: cwflolofficial@gmail.com</p>
      </section>
    </main>
  );
}
