import type { Register, Style, VoiceStrength } from './types';

/**
 * The voices that come with the app: thirteen distinct ways to write, each
 * built the way a voice is built (writers, how far, tone, rules, an anchor,
 * form, phrases to avoid) with one original sample passage. Every sample is
 * the same scene, a late bus in the rain and someone unwelcome sitting down,
 * so the gallery shows the voice and nothing else. Adding one makes it an
 * ordinary voice of your own, free to change.
 */
export interface GalleryVoice {
  key: string;
  name: string;
  /** What it is good for, in a line. */
  blurb: string;
  authors: string[];
  strength: VoiceStrength;
  tone: string;
  rules: string;
  anchor: string;
  pointOfView: string;
  tense: string;
  proseDensity: string;
  dialogueRatio: string;
  register: Register;
  bannedPhrases: string[];
  sample: string;
}

export const GALLERY_SCENE = 'A late bus in the rain, and someone unwelcome sits down.';

const COMMON_BANNED = ['tapestry', 'a testament to', 'palpable', 'shivers down'];

export const GALLERY: GalleryVoice[] = [
  {
    key: 'vonnegut', name: 'Plain and Wry', blurb: 'Deadpan, humane, darkly funny: big sorrows in small words.',
    authors: ['Kurt Vonnegut'], strength: 'close', tone: 'deadpan, humane, darkly funny',
    rules: [
      'Sentences:', '- Short, plain, declarative; many paragraphs are one or two sentences.', '- Words a child knows; a long word is treated as a curiosity.',
      'Narration:', '- The narrator speaks to the reader directly, now and then as "I", and is kind to everyone.', '- Horror and jokes sit side by side in the same flat tone.', '- A short refrain closes absurdities and deaths, and comes back.', '- Time jumps freely; it is fine to say now what happens later.',
      'Dialogue:', '- People say exactly what they mean, or something absurd with total sincerity.',
      'Never:', '- Lingers on lush description.', '- Explains a joke.',
    ].join('\n'),
    anchor: 'Plain words, short paragraphs, a joke that hurts; the narrator leans in, kindly, to say how it really is.',
    pointOfView: 'Third person, with a narrator who addresses the reader', tense: 'Past', proseDensity: 'Very lean', dialogueRatio: 'Short exchanges', register: 'blunt',
    bannedPhrases: [...COMMON_BANNED, 'visceral', 'unspoken'],
    sample: 'Walter Pruitt waited for the number nine bus in the rain. The bus was late. The bus was always late. It was the one thing in Walter’s life he could count on.\n\nThen Dale Fink sat down next to him.\n\nDale Fink had once sold Walter a used car with no reverse gear. Walter drove it forward for two years, which a person can do if he plans his parking.\n\n“Walter,” said Dale.\n\n“Dale,” said Walter.\n\nThey watched the rain. The rain did not care about either of them, which was restful.\n\nI should tell you now that the bus came eleven minutes later, and that Dale died the following spring, of a heart that had been trying to stop for years. Walter went to the funeral. He parked facing out.\n\nIt was that kind of town.',
  },
  {
    key: 'delillo', name: 'Ambient Dread', blurb: 'Cool and uneasy: the hum of modern life with death inside it.',
    authors: ['Don DeLillo'], strength: 'close', tone: 'cool, uneasy, strangely beautiful',
    rules: [
      'Sentences:', '- Flat declaratives, then one sudden lyrical sentence that lifts off.', '- Litanies of brand names, products and media noise, with an incantatory rhythm.',
      'Narration:', '- People notice systems: traffic, screens, forecasts, the hum of consumer life, and sense death inside them.', '- Abstract nouns set beside concrete objects.',
      'Dialogue:', '- Oblique and aphoristic; people answer questions nobody asked.', '- Exchanges loop and stall, then land on a strange truth. "Said" only.',
      'Never:', '- Explains the dread or resolves the unease.',
    ].join('\n'),
    anchor: 'Flat sentences, brand-name litanies, oblique talk; the dread lives in the ordinary hum and is never explained.',
    pointOfView: 'Third person, close on one character', tense: 'Past', proseDensity: 'Lean, with sudden lyric lifts', dialogueRatio: 'Balanced', register: 'clinical',
    bannedPhrases: [...COMMON_BANNED, 'suddenly', 'heart pounding'],
    sample: 'The shelter was glass and steel and someone had scratched a word into it that might have been a name. Rain came down in that steady way that suggests a system. Hart stood under the timetable, which listed buses that had existed at some point.\n\nA woman sat on the bench. He knew her. Dana, from the quarterly meetings. She held a paper cup with a lid that said CAUTION in three languages.\n\n“They say it’s coming,” she said.\n\n“The bus.”\n\n“Something.”\n\nCars went by, spraying. Toyota, Hyundai, a white van with no name on it at all, which was the one he watched.\n\n“I used to think rain was weather,” Dana said. “Now I think it’s information.”\n\nHe wanted to tell her about his father. Instead he read the word on the glass again, and it was not a name.',
  },
  {
    key: 'sanderson', name: 'Epic Clarity', blurb: 'Clear, propulsive fantasy: power with rules, problems solved by thinking.',
    authors: ['Brandon Sanderson'], strength: 'close', tone: 'earnest, propulsive, full of wonder',
    rules: [
      'Sentences:', '- Clear and transparent: a window, not stained glass. Medium length, easy to follow at speed.',
      'Narration:', '- Tight third person on one viewpoint per scene; their thoughts run through the narration.', '- Magic, technology and politics follow visible rules; show limits and costs concretely.', '- Every scene has a goal, an obstacle and a turn; end on momentum or a small reveal.', '- Characters solve problems by reasoning the reader can follow.',
      'Dialogue:', '- Banter between allies; clear motives; earnest moments allowed.',
      'Never:', '- Purple prose.', '- Mystical effects with no cost or rule.',
    ].join('\n'),
    anchor: 'Clear, propulsive prose in a tight viewpoint; problems solved by thinking; power with visible rules and costs; scenes end on a turn.',
    pointOfView: 'Third person, close on one character', tense: 'Past', proseDensity: 'Medium, clean', dialogueRatio: 'Balanced, with banter', register: 'euphemistic',
    bannedPhrases: [...COMMON_BANNED, 'ancient evil', 'little did they know'],
    sample: 'Kell counted the seconds between buses the way her mentor had taught her to count heartbeats. Two hundred and forty. Late again. The rain was the cold kind that came off the harbor, and she would have burned a little of her stored heat against it if she hadn’t needed every scrap for tonight.\n\nSomeone sat down beside her. Kell didn’t need to look.\n\n“Brannick,” she said.\n\n“You always know.” He sounded pleased about it, which was annoying.\n\n“You smell like lamp oil and bad decisions.”\n\nHe laughed, then sobered. “They moved the vault.”\n\nKell’s stomach dropped. Moving the vault meant someone had talked, and only four people knew. She ran through them. Not her. Not Brannick; he’d never have come. That left two.\n\nThe bus hissed around the corner. Kell stood. Now she had a plan, and a much bigger problem.',
  },
  {
    key: 'chandler', name: 'Hardboiled', blurb: 'Tired first person, wisecracks over a moral code, a city that lies.',
    authors: ['Raymond Chandler'], strength: 'close', tone: 'weary, sardonic, melancholy',
    rules: [
      'Sentences:', '- Crisp short lines, with one extravagant simile per paragraph.',
      'Narration:', '- First person: a tired professional who notices clothes, cars, hands and lies.', '- Wisecracks cover a moral code; a melancholy love for a corrupt city.',
      'Dialogue:', '- Fast and sardonic; people talk around what they want; dialogue drives the plot.',
      'Never:', '- Self-pity said plainly.', '- A hero who brags.',
    ].join('\n'),
    anchor: 'Tired first person, wisecracks over a moral code, one wild simile a paragraph, and a city that lies.',
    pointOfView: 'First person', tense: 'Past', proseDensity: 'Lean, with flourishes', dialogueRatio: 'High', register: 'euphemistic',
    bannedPhrases: [...COMMON_BANNED, 'little did I know', 'in that moment'],
    sample: 'The bus was late, which in this town is like saying the rain was wet. I stood under the shelter with my hat brim full of water and my mood about the same.\n\nShe sat down on the bench like she was doing it a favor. Lorna Kade. The last time I saw her she was crying into my office telephone and lying into it at the same time.\n\n“Small world,” she said.\n\n“It keeps getting smaller. Somebody ought to complain.”\n\nShe had a smile like a cheque that might clear. She took out a cigarette and waited for me to light it. I didn’t.\n\n“You still sore about the money?”\n\n“I’m not sore. I’m wet. There’s a difference, but you have to be standing where I am to see it.”\n\nThe headlights came around the corner, slow as a confession.',
  },
  {
    key: 'mccarthy', name: 'Spare and Mythic', blurb: 'Biblical cadence, no quotation marks, a vast indifferent land.',
    authors: ['Cormac McCarthy'], strength: 'close', tone: 'stark, elemental, foreboding',
    rules: [
      'Sentences:', '- Long chains joined by "and", then terse fragments.', '- No quotation marks for dialogue; contractions often lose their apostrophes (dont, cant).',
      'Diction:', '- Rare, exact words for land, tools and weather; a biblical cadence.',
      'Narration:', '- Distant; no interior explanation; people are known by what they do.', '- The landscape is an indifferent witness.',
      'Dialogue:', '- Sparse, laconic, mostly unattributed; long silences.',
      'Never:', '- Explains feelings.', '- Uses exclamation marks.',
    ].join('\n'),
    anchor: 'Long and-chained sentences, then fragments; no quotation marks; plain violence under a vast indifferent sky.',
    pointOfView: 'Third person, distant', tense: 'Past', proseDensity: 'Dense description, spare talk', dialogueRatio: 'Sparse', register: 'blunt',
    bannedPhrases: [...COMMON_BANNED, 'suddenly', 'gasped'],
    sample: 'He stood in the lee of the shelter with the rain coming down slantwise out of a sky the color of old pewter and the road running wet and black toward a town that did not want him. No bus. The schedule nailed to the post had bleached past reading.\n\nThe other man came up the shoulder and sat on the bench without asking and set his hat beside him and looked at the road as if it owed him money.\n\nDidnt think I’d see you again, he said.\n\nNo.\n\nYou still carry that knife.\n\nI carry what I carry.\n\nThe rain fell. Somewhere in the ditch water ran and spoke to itself. They sat like two stones set there by some purpose neither of them would ever be told.',
  },
  {
    key: 'rooney', name: 'Close and Cool', blurb: 'Flat, exact intimacy: feeling in glances and what goes unsaid.',
    authors: ['Sally Rooney'], strength: 'close', tone: 'cool, intimate, quietly aching',
    rules: [
      'Sentences:', '- Flat, precise and unadorned; no quotation marks; speech reported with "he said", "she said".',
      'Narration:', '- Close third that can move between two people; small gestures carry great weight.', '- Feeling shown through what people notice in each other’s faces and silences.', '- Money, class and power come up in conversation, sincerely and awkwardly.',
      'Dialogue:', '- Short, hesitant lines; questions answered with other questions; what matters is not said.',
      'Never:', '- Grand metaphors.', '- Melodrama.',
    ].join('\n'),
    anchor: 'Flat, exact sentences with no quotation marks; feeling lives in glances, pauses and what goes unsaid between two people.',
    pointOfView: 'Third person, close, moving between two people', tense: 'Past', proseDensity: 'Lean', dialogueRatio: 'High', register: 'clinical',
    bannedPhrases: [...COMMON_BANNED, 'electric', 'butterflies'],
    sample: 'The bus was late. Conor stood under the shelter with his hands in his jacket pockets, watching the rain do its usual thing to the street. He had been thinking about nothing, or about how much money was left in his account, which felt similar.\n\nThen Aoife sat down beside him. She said hi without looking at him, the way she used to when they were pretending not to be together in front of other people.\n\nHi, he said.\n\nShe asked if he was going into town. He said yes. She said she was too. Neither of them said anything about the summer.\n\nAfter a while she said: You look tired.\n\nHe felt his face get warm, which was stupid. I’m fine, he said. Are you?\n\nShe looked at him then, properly, and he understood that she wasn’t, and that she had wanted him to ask.',
  },
  {
    key: 'jackson', name: 'Domestic Unease', blurb: 'A polite, cheerful surface over something wrong that nobody names.',
    authors: ['Shirley Jackson'], strength: 'close', tone: 'polite, cheerful, quietly menacing',
    rules: [
      'Sentences:', '- Calm, mannerly, even cheerful, while something is wrong that no one names.', '- Small phrases and rituals repeat.',
      'Narration:', '- The uncanny grows out of domestic detail: hedges, windows, teacups, what the neighbours say.', '- The viewpoint’s reasoning is slightly off, and the reader sees it before they do.',
      'Dialogue:', '- Polite and watchful; social pressure is the threat; pleasantries carry knives.',
      'Never:', '- Gore.', '- An explained monster.',
    ].join('\n'),
    anchor: 'A calm, polite surface over something wrong that nobody names; small rituals, watchful neighbours, dread in the domestic.',
    pointOfView: 'Third person, close on one character', tense: 'Past', proseDensity: 'Medium, neat', dialogueRatio: 'Balanced', register: 'euphemistic',
    bannedPhrases: [...COMMON_BANNED, 'blood-curdling', 'eldritch'],
    sample: 'Mrs. Ferris always waited for the 4:10, and it was always late, and she did not mind, because waiting was a thing one could do properly. She stood beneath the shelter with her umbrella furled, since it was rude to open umbrellas under shelters, and watched the rain.\n\n“Hello, Margaret,” said Mrs. Holloway, sitting down. Mrs. Holloway had not spoken to her since the business with the hedge.\n\n“Hello, Ruth. Isn’t it a lovely rain.”\n\n“Lovely,” said Mrs. Holloway. She folded her hands. “We all think it’s lovely, Margaret. Everyone on the street was saying so.”\n\nMrs. Ferris smiled. Everyone on the street. She thought of the street, all the windows, and how none of the curtains had been drawn this morning, and how friendly that had seemed at the time.\n\n“The bus is late,” she said.\n\n“It is,” said Mrs. Holloway. “For some people.”',
  },
  {
    key: 'pratchett', name: 'Comic Omniscient', blurb: 'A warm, wry narrator explaining the world’s absurd logic.',
    authors: ['Terry Pratchett'], strength: 'close', tone: 'wry, warm, satirical',
    rules: [
      'Narration:', '- An omniscient narrator who digresses to explain how the world, absurdly and logically, works.', '- One aside per paragraph, in parentheses or after a dash.', '- Jokes come from taking metaphors literally and from deadpan logic.', '- Satire of institutions, warmth for people; big ideas in small domestic scenes.',
      'Dialogue:', '- Comic misunderstanding and sharp retorts; every character has a quirk of speech.',
      'Never:', '- Cruelty for its own sake.', '- A joke that stops the story dead.',
    ].join('\n'),
    anchor: 'A warm, wry omniscient narrator who explains the world’s absurd logic in asides; jokes from literal metaphors; heart under the satire.',
    pointOfView: 'Omniscient', tense: 'Past', proseDensity: 'Medium', dialogueRatio: 'Balanced', register: 'euphemistic',
    bannedPhrases: [...COMMON_BANNED, 'epic', 'chosen one'],
    sample: 'The omnibus to Lower Brantwick was late, as was traditional. The timetable had been drafted by a committee that believed lateness was a kind of politeness, giving passengers time to finish their thoughts.\n\nGerald Mumm stood beneath the shelter, where by local bylaw the rain was obliged to fall only diagonally.\n\nSomeone sat down next to him with the air of a person who had been looking for him for some time.\n\n“Hello, Gerald,” said his sister-in-law.\n\nThere are sounds the human heart makes that medicine has never recorded. One of them is the small, resigned click of a man realising that the next forty minutes are no longer his own.\n\n“Hello, Hester.”\n\n“You’ll be wanting to know about the will,” said Hester, who had never in her life waited to be asked anything.',
  },
  {
    key: 'carver', name: 'Minimal', blurb: 'Short plain sentences, working lives, small talk circling what hurts.',
    authors: ['Raymond Carver'], strength: 'close', tone: 'bleak, tender, unadorned',
    rules: [
      'Sentences:', '- Short and simple; plain working words; names repeated ("Earl said").',
      'Narration:', '- Domestic, working-class settings: kitchens, cars, motels; drink, money, marriage.', '- People cannot say what they feel; the narration never says it for them.',
      'Dialogue:', '- Small talk that circles what hurts; repetitions; questions left hanging.',
      'Structure:', '- Endings stop short, on an image, with nothing resolved.',
      'Never:', '- Lyrical flights or metaphors.', '- Explanations of motive.',
    ].join('\n'),
    anchor: 'Short plain sentences, small talk that circles what hurts, working lives, and an ending that just stops.',
    pointOfView: 'Third person, close', tense: 'Past', proseDensity: 'Very lean', dialogueRatio: 'High', register: 'blunt',
    bannedPhrases: [...COMMON_BANNED, 'realized', 'epiphany'],
    sample: 'The bus was late. Earl stood under the shelter and lit a cigarette and it went out in the rain. He lit another one.\n\nA woman sat down on the bench. It was Fran. He hadn’t seen her since she moved out.\n\n“Earl,” she said.\n\n“Fran.”\n\nShe had on a new coat. It was red. He didn’t say anything about it.\n\n“You going to work?” she said.\n\n“I don’t have work. I’m going to see about work.”\n\n“That’s good, Earl. That’s something.”\n\nHe looked at the cigarette. He looked at the road. “You want a cigarette?” he said.\n\n“I quit,” Fran said.\n\n“Since when?”\n\nShe didn’t answer. The bus came down the hill with its lights on, though it was the middle of the day.',
  },
  {
    key: 'child', name: 'Lean Thriller', blurb: 'Punchy and tactical: numbers, threats read, a laconic hero.',
    authors: ['Lee Child'], strength: 'close', tone: 'tense, laconic, controlled',
    rules: [
      'Sentences:', '- Short; many fragments; one-line paragraphs for punch.',
      'Narration:', '- Precise numbers: distances, times, weights, odds. The hero calculates.', '- Fights, tactics and weapons in calm procedural detail.', '- Tension from the clock and from threat assessment.',
      'Dialogue:', '- Laconic; the hero says less than anyone in the room.',
      'Never:', '- Introspective rambling.', '- Feelings named outright.',
    ].join('\n'),
    anchor: 'Short punchy sentences, precise numbers, calm tactical detail, a laconic hero reading every threat.',
    pointOfView: 'Third person, close on the hero', tense: 'Past', proseDensity: 'Very lean', dialogueRatio: 'Sparse', register: 'blunt',
    bannedPhrases: [...COMMON_BANNED, 'heart raced', 'time stood still'],
    sample: 'The bus was nine minutes late. Hale didn’t mind. Nine minutes was information.\n\nRain. Steady, maybe a quarter inch an hour. The shelter was eight feet wide. One bench. One way in.\n\nA man sat down on the far end. Two hundred pounds, maybe a little more. Wet shoes but a dry collar, which meant a car parked close. Hale knew him. Pruitt. Last seen in a parking garage in Ohio, losing an argument.\n\n“Long way from home,” Pruitt said.\n\n“I don’t have one.”\n\nPruitt’s right hand stayed in his coat pocket. Small revolver, probably. Five rounds. At this range it wouldn’t matter.\n\nHale did the math. Bench, three feet. Pruitt’s hand, four inches from the trigger. His own reach, longer.\n\n“Bus is coming,” Hale said.\n\nIt wasn’t. But Pruitt looked.',
  },
  {
    key: 'leguin', name: 'Clear and Humane', blurb: 'Calm, wise and curious: other cultures seen with care.',
    authors: ['Ursula K. Le Guin'], strength: 'close', tone: 'calm, wise, quietly hopeful',
    rules: [
      'Sentences:', '- Clear and unhurried, with a storyteller’s calm; plain words carrying moral weight; now and then an aphorism.',
      'Narration:', '- Customs, ecologies and politics observed with an anthropologist’s curiosity and respect.', '- Conflict is resolved through understanding more often than force; everyone keeps their dignity.', '- The rhythm of a tale told aloud.',
      'Dialogue:', '- Measured and meaningful; silences count as answers.',
      'Never:', '- Cynicism.', '- Gratuitous violence or jargon.',
    ].join('\n'),
    anchor: 'Calm, clear, humane prose with an anthropologist’s curiosity; plain words carrying moral weight; understanding over force.',
    pointOfView: 'Third person, close', tense: 'Past', proseDensity: 'Medium, clear', dialogueRatio: 'Balanced', register: 'euphemistic',
    bannedPhrases: [...COMMON_BANNED, 'badass', 'epic'],
    sample: 'In that city it was thought unlucky to complain about the buses, and so people did not, though the buses were late as often as the rain was wet. Teso waited under the shelter in the others’ silence.\n\nThe woman who sat beside him was Anarra, who had been his teacher once and was now his opponent in the council. They greeted each other in the old way, palms open, which means: I hold nothing.\n\n“You will speak against the reservoir tomorrow,” she said.\n\n“I will.”\n\n“Good. Someone should.” She watched the rain run off the roof edge in a thin bright line. “When I was young I thought being right was a place you arrived at. It is more like weather.”\n\nHe did not answer. He was learning, slowly, that not answering was also a way of listening.',
  },
  {
    key: 'austen', name: 'Ironic Society', blurb: 'Balanced, witty sentences; manners, money and barbs under politeness.',
    authors: ['Jane Austen'], strength: 'close', tone: 'witty, ironic, affectionate',
    rules: [
      'Sentences:', '- Balanced, periodic sentences with an ironic turn at the end; aphoristic openings.',
      'Narration:', '- Free indirect style slips into a character’s opinions and lets the irony show.', '- Money, marriage, reputation and manners drive everything; feeling is expressed through propriety.',
      'Dialogue:', '- Polite and barbed; character revealed by what it is permissible to say.',
      'Never:', '- Modern slang.', '- Crude bodily description or open melodrama.',
    ].join('\n'),
    anchor: 'Balanced, ironic sentences; free indirect wit; manners, money and reputation driving every exchange; barbs under politeness.',
    pointOfView: 'Third person, omniscient with free indirect style', tense: 'Past', proseDensity: 'Medium, elegant', dialogueRatio: 'High', register: 'euphemistic',
    bannedPhrases: [...COMMON_BANNED, 'okay', 'awesome'],
    sample: 'It is a truth not sufficiently remarked upon that a late coach will always bring forward the one acquaintance a person had most hoped to avoid. Mr. Hartley, standing beneath the shelter at the corner of Milsom Street with his umbrella in good order and his patience in rather less, was soon to prove it.\n\nMrs. Elton-Shaw sat down upon the bench with every appearance of having been invited.\n\n“Mr. Hartley! What a happy chance. I had quite despaired of company.”\n\n“The rain is a great leveller of company, madam.”\n\n“Oh, you are severe! But I forgive it; my sister always says a gentleman out of temper is only a gentleman in want of dinner.”\n\nMr. Hartley, who had dined, and handsomely, reflected that her sister said a great many things, and that most of them had reached him.',
  },
  {
    key: 'gibson', name: 'Neon Cool', blurb: 'Dense, cool, compressed: brands, tech and grey markets.',
    authors: ['William Gibson'], strength: 'close', tone: 'cool, detached, glittering',
    rules: [
      'Sentences:', '- Dense, compressed noun phrases; fragments heavy with texture.',
      'Diction:', '- Brands, tech and street slang dropped without explanation.', '- Similes drawn from screens, media and machines.',
      'Narration:', '- Cool, detached affect; characters are professionals in grey markets; surfaces tell the story.',
      'Dialogue:', '- Clipped, elliptical, everyone a little guarded.',
      'Never:', '- Explains the technology.', '- Sentimental speeches.',
    ].join('\n'),
    anchor: 'Dense, cool, compressed prose; brands and tech dropped unexplained; grey-market professionals and similes from screens.',
    pointOfView: 'Third person, close', tense: 'Past', proseDensity: 'Dense', dialogueRatio: 'Sparse', register: 'clinical',
    bannedPhrases: [...COMMON_BANNED, 'cyberspace', 'hacker voice'],
    sample: 'The rain over the depot was the color of a dead screen, static-grey and fine as data. Cass stood in the shelter’s blue LED wash, phone dark in her pocket, watching the arrivals board scroll apologies in four languages. Bus 31, delayed. Delayed being a state, not an event.\n\nSomeone settled onto the bench. Cheap cologne, a Muji coat a size too optimistic. Oren. Ex-fixer, ex-friend, ex-a lot of things.\n\n“Heard you were out,” he said.\n\n“Out of what.”\n\n“Everything.” He smiled the way people smiled in ads for things that didn’t exist yet. “There’s a job.”\n\n“There’s always a job.”\n\n“This one comes with a clean history.”\n\nAcross the street a hoarding cycled through a perfume nobody could afford, a face too symmetrical to have been born. Cass watched it twice before she answered.',
  },
];

/** A gallery voice's stable id: adding it twice opens the one already added. */
export const galleryId = (key: string) => `gallery-${key}`;

/** A gallery voice as a voice of your own, ready to save. */
export function galleryStyle(g: GalleryVoice, at: number): Style {
  return {
    id: galleryId(g.key), name: g.name, system: '', prefill: '', postHistory: '', modelOverrides: {}, refusalChain: [], systemAsUser: false, providerIgnore: [], providerOrder: [],
    pointOfView: g.pointOfView, tense: g.tense, proseDensity: g.proseDensity, dialogueRatio: g.dialogueRatio, register: g.register, vocabulary: '', influences: '', repetition: 'light',
    bannedPhrases: g.bannedPhrases, samples: [g.sample],
    voice: { authors: g.authors, strength: g.strength, tone: g.tone, rules: g.rules, anchor: g.anchor },
    createdAt: at, updatedAt: at,
  };
}
