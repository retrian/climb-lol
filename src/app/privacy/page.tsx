import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | CWF.LOL",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12 text-sm leading-6 text-slate-200">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-white">CWF.LOL — Privacy Policy</h1>
        <p className="text-slate-300">Effective date: February 12, 2026</p>
      </header>

      <section className="flex flex-col gap-3">
        <p>
          This Privacy Policy explains what CWF.LOL (“we”) collects, how we use
          it, and your choices.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">1) Information We Collect</h2>
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold text-white">A) Account information</h3>
          <p>
            If you sign in (e.g., Google OAuth), we receive basic account
            identifiers such as email address and a user ID.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold text-white">B) Riot / gameplay-related information</h3>
          <p>
            When you add players (by Riot ID) or view leaderboards, we may
            process publicly available gameplay data and match/stat data
            retrieved via Riot APIs (e.g., Riot ID, PUUID, match IDs, ranks, LP
            changes, champions, and match results), and we may store cached
            copies to improve performance.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold text-white">C) User content</h3>
          <p>
            If you post content (e.g., highlight links, club posts, tournament
            posts), we collect what you submit and associated metadata (time
            posted, author, etc.).
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold text-white">D) Usage data</h3>
          <p>
            We may collect basic analytics and log data (e.g., IP address,
            device/browser info, pages viewed, and approximate location) to
            secure and improve the Service.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">2) How We Use Information</h2>
        <p>We use information to:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>provide and operate the Service (leaderboards, clubs, match/stat views);</li>
          <li>authenticate users and prevent abuse;</li>
          <li>maintain performance (caching, rate limiting, debugging);</li>
          <li>communicate with you about account or support issues;</li>
          <li>run billing if you choose paid features (if applicable).</li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">3) How We Share Information</h2>
        <p>We may share information:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            publicly, when you use public leaderboards/clubs or public posts
            (what’s public is visible to anyone);
          </li>
          <li>
            with service providers that help us run the Service (hosting,
            database, analytics, email, payments);
          </li>
          <li>
            if required by law or to protect rights, safety, and security.
          </li>
        </ul>
        <p>We do not sell personal information.</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">4) Data Retention</h2>
        <p>
          We keep information as long as needed to operate the Service, comply
          with legal obligations, and resolve disputes. You can request deletion
          of your account data (see Section 6).
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">5) Cookies / Analytics</h2>
        <p>
          We may use cookies or similar technologies for login, preferences, and
          basic analytics. You can control cookies through your browser settings
          (some features may not work without them).
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">6) Your Choices and Rights</h2>
        <p>
          You may request access to, correction of, or deletion of your account
          information by contacting us at: cwflolofficial@gmail.com. If you are
          in certain regions (e.g., EU/UK/California), you may have additional
          rights under local law.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">7) Security</h2>
        <p>
          We use reasonable administrative, technical, and organizational
          safeguards to protect data, but no online service can guarantee
          absolute security.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">8) Changes</h2>
        <p>
          We may update this Policy. We will post the updated version with a new
          effective date.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">9) Contact</h2>
        <p>Privacy questions or requests: cwflolofficial@gmail.com</p>
      </section>
    </main>
  );
}
