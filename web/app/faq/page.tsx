/**
 * Frequently Asked Questions — a static, content-only page reachable from
 * the global SiteNav. Styled to match the parchment/ink theme used across
 * the landing and play screens. Each entry is a native <details> element so
 * answers collapse/expand without any client-side JS (the page can stay a
 * server component).
 */
import Link from "next/link";
import { withBasePath } from "@/util/basePath";

type Faq = { q: string; a: React.ReactNode };

const FAQS: ReadonlyArray<Faq> = [

  {
    q: "What is Wilderstep: Infinite Abyss?",
    a: (
      <>
        Wilderstep is a top-down, turn-based RPG inspired by Ultima III and
        classic tabletop D&amp;D. You lead a party of four adventurers through an
        open world of overworld exploration, town visits, dungeon delving, and
        chessboard-like tactical combat.
        <br/><br/>
        Wilderstep ships with a full-length playable adventure named Emberscar, a classic
        save the realm style RPG adventure with side quests and boss creatures to defeat.
        <br/><br/>
        At it's core though, Wilderstep is more of an RPG system than a standalone game and 
        comes with Dungeon Master mode which lets you choose your own adventures. You can build
        an entire RPG world from scratch including your own monsters, maps, towns and characters.
        Or you can use the libaries and other built-in content to remix the game to share with
        your friends.
      </>
    ),
  },


    {
    q: "How do I get an account?",
    a: (
      <>
        Accounts are secured via your email address and only provide a method for you to edit 
        and publish your own adventures. The core features of the game are managed locally 
        in your web browsers built-in data storage system.
        <br/><br/>
        However, if you want access to Dungeon Master Mode which gives you the ability to build
        your own adventures you can request an account by emailing me at mjcampbell74@gmail.com.
        <br/><br/>
        Once I add you to our list, you will be able to sign into the app using tokens provided
        by an authentication service provided by Cloudflare (you will see emails from Cloudflare
        when you log in).
      </>
    ),
  },


    {
    q: "How do I get started with Dungeon Master Mode?",
    a: (
      <>
The game is organized in modules, which include everything that defines an 
adventure including monsters, maps, quests, and so on. Every module inherits the core game 
via the Default Module. Default Module has all the monsters and characters used in the game.
<br/><br/>
When you create New Module, you start with a map and party already set up. You can create the 
module adventure and immediately play a new game with it.
<br/><br/>
So to get started, go to the Maps list in the module and choose the map "Rock Island". You will
see a copy of the map that you can use to edit. Click on a tile to see it's properties where 
you can add encounters, quests, and much more. On the left is a palette that you can use 
to paint more tiles.
<br/><br/>
The items in the game that you can edit are all in the left panel. This is where you would 
add new monsters, encounters, and quests.
<br/><br/>
You must "Publish" your changes when you are ready to see them in your module. This is what
writes your changes to the server and allows you to share your adventure.
      </>
    ),
  },


  {
    q: "How much does it cost, and do I need to install anything?",
    a: (
      <>
        It&apos;s free and runs entirely in your browser — there&apos;s nothing
        to download or install. Just press{" "}
        <Link href="/play" className="text-ember underline">
          Play
        </Link>{" "}
        and start adventuring.
      </>
    ),
  },
  {
    q: "How are my games saved?",
    a: (
      <>
        Progress is auto-saved in your browser, and you can keep up to three
        manual save slots (press ⌘S in game). Because saves live in your
        browser&apos;s storage, clearing site data will erase them — use{" "}
        <strong>Export Save</strong> on the Play screen to download a backup
        file you can re-import later or move to another device.
      </>
    ),
  },
  {
    q: "Do I need an account?",
    a: (
      <>
        No account is needed to play. Signing in only unlocks Dungeon Master
        mode, where you can build and publish your own adventures.
      </>
    ),
  },
  {
    q: "What is Dungeon Master mode?",
    a: (
      <>
        Dungeon Master mode is Wilderstep&apos;s full game-development kit. Once
        signed in, you can create new maps, monsters, quests, soundtracks, and
        complete modules, then share them. The combat and dungeon simulators let
        you test encounters before publishing.
      </>
    ),
  },
  {
    q: "What character classes and races are available?",
    a: (
      <>
        There are 8 character classes and 5 races, each with unique abilities to
        suit different playstyles, plus rich sorcerer and priest spell lists. The
        full breakdown lives in the Player&apos;s Manual.
      </>
    ),
  },
  {
    q: "Where can I learn the rules in detail?",
    a: (
      <>
        The{" "}
        <a
          href={withBasePath("/manual.pdf")}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ember underline"
        >
          Player&apos;s Manual
        </a>{" "}
        (PDF) covers character creation, combat, spells, crafting, and more in
        depth.
      </>
    ),
  },
  {
    q: "I found a bug or have a suggestion — what should I do?",
    a: (
      <>
        Wilderstep is actively evolving. Bug reports and ideas are welcome on the{" "}
        <Link href="https://github.com/mattjcamp/wilderstep_infinite_abyss" className="text-ember underline">
          Wilderstep Github Repository
        </Link>, and exporting an affected save file makes
        issues much easier to reproduce.
      </>
    ),
  },
];

export default function FaqPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-8">
      <header className="text-center">
        <h1 className="font-display text-5xl text-parchment">
          Frequently Asked Questions
        </h1>
        <p className="mt-3 text-parchment/60">
          Answers to common questions about Wilderstep: Infinite Abyss.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        {FAQS.map(({ q, a }, i) => (
          <details
            key={i}
            className="group rounded-md border border-parchment/20 bg-ink/40 px-5 py-3 transition hover:border-parchment/40"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-lg text-parchment marker:content-['']">
              <span>{q}</span>
              <span className="text-parchment/50 transition group-open:rotate-45">
                +
              </span>
            </summary>
            <div className="mt-3 text-parchment/75">{a}</div>
          </details>
        ))}
      </section>

    </main>
  );
}
