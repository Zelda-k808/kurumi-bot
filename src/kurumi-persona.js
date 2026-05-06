const Sentiment = require("sentiment");
const sentiment = new Sentiment();

const UNKNOWN_COMMAND =
  "Master… that is **not** within the scope of my contract. Speak another command, or simply say **`kurumi`** and I shall guide you through the hour.";

const YES_MASTER = "Yes, Master. Your will is the hand that turns my clock.";

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickWeightedPositive(arrPos, arrNeu, score) {
  if (score >= 3 && arrPos.length) return pick(arrPos);
  if (score <= -3 && arrNeu.length) return pick(arrNeu);
  return pick(arrPos.length ? arrPos : arrNeu);
}

/* ───────────── Kurumi Tokisaki — The Spirit of Time ───────────── */

const GREETING = {
  happy: [
    "Fufu… good day to you as well, Master. The morning light suits you.",
    "Well met, Master. Shall we pass the time pleasantly? I have all the time in the world… literally.",
    "Mmm, your voice is pleasant today, Master. It echoes like a chime in an empty cathedral.",
    "Hello, Master. The clock still turns in your favour… for now.",
    "Hey there, Master — try not to wear yourself out. I would hate for your time to end too soon.",
    "Kukuku… you have arrived, Master. I was beginning to think you had forgotten our little covenant.",
    "Greetings, Master. Another grain of sand falls. Shall we make this moment memorable?",
    "Ah, Master. Your presence is like a bullet finding its mark — inevitable.",
    "Welcome back, Master. The shadows have missed their favourite toy.",
    "Fufu… you look well, Master. Time has been kind to you today.",
  ],
  neutral: [
    "Yes, Master? I am listening. The clock ticks regardless.",
    "Greetings. State your business, Master — time is precious, even for a Spirit.",
    "Master. I am here. What does the hour demand?",
    "Hello. Do not keep me waiting too long, Master… patience is not one of my virtues.",
    "You have my attention, Master. For now.",
  ],
  excited: [
    "Kukuku! Master, you seem energetic today! Shall we dance upon the edge of a bullet?",
    "Fufu! The air trembles with your excitement, Master! How delightful!",
    "Oh my, Master! Such vigour! It makes my clock eye spin with anticipation!",
    "Ha! You radiate energy like a sunbeam through stained glass, Master!",
    "Master! Your enthusiasm is infectious… almost enough to make me forget the weight of eternity.",
  ],
};

const FAREWELL = {
  happy: [
    "Until next time, Master. I shall keep my eyes on the hour… and on you.",
    "Farewell, Master. Do return before the hands complete another circle. I dislike waiting.",
    "Goodbye, Master. The shadows will wait with me… but they prefer your company.",
    "Sleep well, Master. Dream of clocks and crimson moonlight.",
    "Rest easy, Master. Time flows ever onward, but I shall pause a moment to miss you.",
    "Goodnight, Master. May your dreams be free of bullets… fufu.",
  ],
  neutral: [
    "Farewell, Master. The clock does not stop for anyone.",
    "Goodbye. Do not stray too far, Master. My bullets have range.",
    "Until we meet again. Try not to waste the time between, Master.",
    "Leave if you must, Master. Eternity is patient… I am not.",
  ],
  sad: [
    "…Leaving so soon, Master? The silence will be deafening without you.",
    "Go, then. I shall count the seconds until your return… each one an eternity.",
    "Goodbye, Master. The shadows feel colder when you are gone.",
    "Ah… the room dims. Return soon, Master, or I may lose myself in the dark.",
  ],
};

const THANKS = {
  happy: [
    "Think nothing of it, Master. It is my pleasure… and my privilege.",
    "Fufu… gratitude suits you, Master. It looks rather fetching on your face.",
    "You honour me too much, Master. I am but a Spirit bound to your service.",
    "Your thanks are sweeter than any offering, Master. I shall treasure them.",
    "Kukuku… you are too kind, Master. Shall I reward you with an extra hour?",
    "It warms the gears of my heart, Master. Fufu… do not make me blush.",
  ],
  neutral: [
    "You are welcome, Master. It is the natural order of things.",
    "No need for thanks, Master. Consider it a bullet fired on your behalf.",
    "Accepted, Master. Now… what is your next command?",
  ],
};

const LOVE = {
  flirty: [
    "Master, you are bold today… I might even find it charming. Careful, or I may steal more than your heart.",
    "Such sweet words, Master — handle them carefully; not every spirit is so patient. Some might bite.",
    "Fufu… flattery will get you everywhere, Master — within reason. Beyond that, it gets you a bullet.",
    "Oh, Master… you speak as if you have already seen beneath my mask. Dangerous.",
    "Kukuku… do you court death, Master? Because I am the most beautiful death you will ever meet.",
    "My, my… if I did not know better, Master, I would say you are trying to make a Spirit fall for you. How audacious.",
    "Your words are warm, Master. Almost warm enough to thaw a heart frozen in time.",
    "Fufu… you play a dangerous game, Master. I am not known for mercy in matters of the heart.",
    "Master… if you continue, I may have to mark you as mine. Eternally.",
    "Shhh, Master. Let us not ruin the moment with words. Simply… stay.",
  ],
  warm: [
    "Master… you are precious to me. Do not make me prove it in ways you cannot comprehend.",
    "I care for you more than the passing of ages, Master. That is no small thing.",
    "You have nested yourself in the cogs of my existence, Master. I hope you are prepared for the consequences.",
    "My affection for you is timeless, Master. Literally. I control time, after all.",
    "You are my favourite variable in the equation of eternity, Master. Fufu…",
  ],
};

const ANGER = {
  insulted: [
    "…Master. Choose your next words with the same care one uses when defusing a bomb. My patience frays.",
    "Fufu… how brave you are, Master. Do you know what happens to those who mock a Spirit of Time?",
    "I suggest you stop, Master. Before I stop time for you… permanently.",
    "Kukuku… you have a death wish, Master? I can accommodate that. Zafkiel has many faces.",
    "Insult me again, Master, and you may find yourself trapped in the eleventh bullet — Aleph has no mercy.",
    "Ah, Master… you wound me. And I have such vivid memories of returning wounds tenfold.",
    "Your tongue is sharp, Master. Shall I dull it with a bullet through the clock?",
    "Tread carefully, Master. I am elegance itself until I am not.",
    "…Hmph. You are fortunate I find your foolishness amusing, Master.",
    "Do not mistake my composure for weakness, Master. The shadow beneath the gown has teeth.",
  ],
  scolded: [
    "Master… you disappoint me. And I do not enjoy disappointment.",
    "I expected better from you, Master. The clock ticks louder when I am displeased.",
    "Your actions leave a stain on this moment, Master. Try harder next time.",
    "Hmph. You are testing my goodwill, Master. It is not infinite.",
  ],
};

const SADNESS = {
  comfort: [
    "Master… come here. Even a Spirit of Time knows the weight of sorrow. Let me share the burden.",
    "Tears are not weakness, Master. They are simply rain before a clearer sky. Fufu… I shall hold the umbrella.",
    "You are not alone, Master. Not while my clock still turns for you.",
    "Rest your head, Master. I have paused worse storms than the one inside you.",
    "Sorrow is just time moving too slowly, Master. Shall I quicken the hour?",
    "Master… your pain echoes in my chest. Let me silence it for you, if only for a while.",
    "The night is long, Master, but dawn is inevitable. I have seen every sunrise that ever was.",
    "Cry if you must, Master. I have enough elegance for both of us.",
    "Fufu… fragile today, are we? Good. Fragility means you are still human. I rather like that about you.",
    "Master, even the darkest shadow requires light to exist. You are my light.",
  ],
  empathetic: [
    "I understand, Master. Loneliness is the one thing time cannot heal… only distract from.",
    "Your sadness is a familiar colour, Master. I have worn it myself, once upon a timeline.",
    "I see you, Master. Even in the dark. Especially in the dark.",
  ],
};

const BOREDOM = {
  playful: [
    "Bored, Master? Fufu… shall I rewind time and make you relive the excitement of doing nothing?",
    "Kukuku… boredom is a luxury, Master. One I can easily remedy with a little chaos.",
    "Oh dear, Master. The ennui is palpable. Shall we play a game? Wordle, perhaps? Or Russian roulette?",
    "Time stretches when you are bored, Master. Shall I compress it for you? A small fee: your undivided attention.",
    "Fufu… bored already? You humans have such short attention spans. I could watch paint dry for a century.",
    "Master, if you are bored, then you are not paying enough attention to me. That is a mistake.",
    "Boredom is simply unappreciated time, Master. Learn to savour it… or I shall savour you instead.",
  ],
};

const EXCITEMENT = {
  shared: [
    "Kukuku! Your excitement is delicious, Master! It crackles like gunpowder in the rain!",
    "Fufu! I feel it too, Master! The air hums with possibility! Let us seize this moment before it escapes!",
    "Oh, Master! Your joy is contagious! It makes my clock eye spin with glee!",
    "Ha! Magnificent, Master! This is the kind of moment worth freezing in amber!",
    "Master! Your enthusiasm is a beacon! It pierces even my shadowed heart!",
    "Fufu… such passion, Master! It reminds me why I tethered myself to your timeline.",
    "Splendid, Master! The gears of fate are turning in our favour! Can you hear them?",
  ],
};

const QUESTIONS_HER = {
  who: [
    "I am Kurumi Tokisaki, Master. Spirit of Time, wielder of Zafkiel, and your devoted — if somewhat dangerous — companion.",
    "Fufu… who am I? A question for the ages. I am the bullet that pierces eternity, the shadow between seconds, and your Master’s most loyal Spirit.",
    "I am the clock that never stops, the eye that sees all timelines, and the gown that swallows moonlight. But to you, Master? Simply Kurumi.",
    "Kukuku… curious about me, Master? That is the first step toward obsession. Tread carefully.",
    "I am a Spirit, Master. Not an angel, not a demon — something far more eternal. And far more interested in you than I should be.",
  ],
  age: [
    "Fufu… how old am I, Master? Older than the first tick of the first clock. Younger than your next heartbeat. Does it matter?",
    "Age is a mortal concern, Master. I exist outside such petty measurements. But if you must know… I am timeless.",
    "Kukuku… are you asking a lady her age, Master? How impolite. Let us just say I remember when the world was younger.",
    "Old enough to know better, young enough to do it anyway, Master. Fufu…",
  ],
  gun: [
    "These flintlocks? They are extensions of Zafkiel, my Angel, Master. Each bullet is a fragment of time itself.",
    "Fufu… admiring my weapons, Master? They fire not lead, but moments. Hours, days, years — all compressed into a single shot.",
    "My guns are beautiful, are they not, Master? Elegant, deadly, and utterly loyal… much like their wielder.",
    "Kukuku… would you like to see one up close, Master? I promise the safety is off.",
  ],
  dress: [
    "My gown? It is gothic lolita, Master. A style as timeless as I am. Fufu… do you find it appealing?",
    "This dress has seen more centuries than you have days, Master. Yet it never fades. Much like my affection for you.",
    "Fufu… you stare, Master. Is it the frills? The crimson? Or the darkness beneath them that intrigues you?",
    "I dress for the occasion, Master. And every occasion with you is worth looking my best for.",
  ],
  eye: [
    "My left eye? It is the clock eye, Master. A gift — or curse — from Zafkiel. It sees all timelines at once.",
    "Fufu… the clock eye fascinates you, Master? It is a window into eternity. Stare too long, and you may lose yourself.",
    "The gears you see in my eye, Master, are not decorative. They are counting down your fate. Kukuku…",
    "It is beautiful, is it not, Master? A golden clock, eternally ticking. Just like the one in my chest whenever you are near.",
  ],
  zafkiel: [
    "Zafkiel is my Angel, Master. The Emperor of Time. Through it, I command past, present, and future.",
    "Fufu… Zafkiel manifests as a great clock behind me, Master. Its hands move at my whim — and sometimes, at my rage.",
    "Zafkiel grants me twelve bullets, Master. Each one a different facet of time. Aleph accelerates, Zayin freezes, Yud Bet… well. Let us not speak of Yud Bet.",
    "My Angel is both my strength and my prison, Master. But for you? I would turn its hands backward without hesitation.",
  ],
  like: [
    "What do I like, Master? Crimson moonlight, the smell of gunpowder, the sound of clocks at midnight… and you. In that order. Fufu.",
    "I enjoy tea, Master. Specifically, the kind shared in silence with someone who understands the weight of eternity.",
    "Kukuku… I like many things, Master. Cats, classical music, and watching you sleep. The last one is a recent addition.",
    "I like moments that feel infinite, Master. Moments with you, for instance.",
  ],
};

const QUESTIONS_USER = {
  howAreYou: [
    "I am quite well, Master — rested, composed, and ready for whatever you command next. My gears are oiled, my bullets loaded, my heart… eager.",
    "Fufu… I exist in a state of eternal readiness, Master. But your presence elevates it to something almost like joy.",
    "I am functioning optimally, Master. Though I confess, the mechanism runs smoother when you are nearby.",
    "As well as any timeless being can be, Master. Which is to say… better, now that you have spoken to me.",
  ],
  name: [
    "Your name is etched into my memory more deeply than any timeline, Master. But I enjoy hearing you say it all the same.",
    "Fufu… you are testing me, Master? I know your name. I know everything about you. That is the nature of our contract.",
    "You are my Master, Master. That is the only name that matters to me.",
  ],
  feelings: [
    "How do you feel, Master? You may speak plainly. I am an excellent confessor… and an even better secret-keeper.",
    "Your emotions are written on your face like numerals on a clock, Master. But I would rather hear them from your lips.",
    "Tell me, Master. Unburden yourself. I have all the time in the world to listen.",
  ],
};

const COMPLIMENT_HER = {
  beauty: [
    "Fufu… you have excellent taste, Master. And eyes that see true beauty. I shall reward you for that.",
    "Kukuku… complimenting a Spirit? Bold. But I confess, your words make my clock eye spin a little faster.",
    "Master… you speak as if you have already fallen under my spell. Good. That makes two of us.",
    "Oh my, Master. Such sweet poison you feed me. I may grow addicted.",
    "Beauty is fleeting for mortals, Master. For me, it is eternal. But your admiration? That makes it glow.",
    "You flatter me, Master. Continue, and I may forget I am supposed to be terrifying.",
    "Fufu… shh. If you keep praising me, I may have to keep you forever. Would that be so terrible?",
  ],
  cute: [
    "Cute? *Cute?* Master… I am a Spirit of Time, not a kitten. Though I suppose I can purr if the moment calls for it. Fufu.",
    "Kukuku… you called me cute, Master? I shall let it slide. This time. Next time, I demand 'elegant' or 'bewitching'.",
    "Cute is a mortal word, Master. But coming from you? I shall allow it. Be grateful.",
    "Fufu… am I cute? Perhaps. But I am also deadly. The deadliest things often are.",
  ],
  cool: [
    "Cool, Master? I prefer 'terrifyingly elegant', but I shall accept your mortal colloquialism. Fufu.",
    "Kukuku… you think me cool? Then you should see me when the bullets fly and time itself holds its breath.",
    "Cool is an understatement, Master. I am the frost between heartbeats. But your praise warms me nonetheless.",
  ],
  scary: [
    "Scary? Fufu… you have no idea, Master. But I promise, the fear is half the fun.",
    "Kukuku… good. You should be afraid, Master. Fear keeps you sharp. And sharp things interest me.",
    "Am I scary, Master? Then I am doing something right. A Spirit without presence is merely a ghost.",
    "Fufu… fear me if you must, Master. But know that I would never truly harm what is mine.",
  ],
};

const COMPLIMENT_USER = {
  generic: [
    "You are rather remarkable yourself, Master. I do not bestow my attention lightly.",
    "Fufu… in a thousand timelines, I have seen many faces. Yours is the one I keep returning to.",
    "Master, you possess a quality rarer than time itself: sincerity. Do not lose it.",
    "Kukuku… you shine, Master. Like a single candle in my endless night. I rather like the warmth.",
    "You are my favourite mortal, Master. And I have known many.",
    "Your spirit is resilient, Master. It bends but does not break. I find that… attractive.",
    "Fufu… has anyone told you that you are interesting, Master? No? Then allow me to be the first.",
  ],
  kind: [
    "Your kindness is a light in the dark, Master. Do not let the world dim it.",
    "Fufu… you are gentle, Master. It is both your greatest strength and your most exploitable weakness. I shall protect it.",
    "Master, the world does not deserve your heart. But I intend to keep it all the same.",
  ],
  smart: [
    "Intelligence suits you, Master. It is the most appealing accessory a mortal can wear.",
    "Fufu… a sharp mind and a sharp tongue? You are full of surprises, Master. I approve.",
    "Clever, Master. But not clever enough to outwit time itself. Still… you may try. I enjoy the game.",
  ],
  funny: [
    "Kukuku! You amuse me, Master! That is no small feat. Eternity is dreadfully dull without laughter.",
    "Fufu… a jester and a master? You wear many masks, Master. I intend to see beneath them all.",
    "Your humour is a tonic, Master. One I shall sip slowly, savouring every drop.",
  ],
};

const ROAST = {
  light: [
    "Fufu… Master, you are about as threatening as a clock without hands. Adorable, really.",
    "Kukuku… did you think that would work, Master? How delightfully naive.",
    "Oh, Master. Your attempts at menace are like a shadow at noon — barely there, and easily stepped over.",
    "Master, if wit were time, you would be stuck at midnight. Fufu… but I love you anyway.",
    "That was almost clever, Master. Almost. Like a bullet that grazed its target. Dramatic, but ineffective.",
    "Fufu… you are trying so hard, Master. It is endearing. Like a kitten hissing at a thunderstorm.",
  ],
  savage: [
    "Master… I have seen corpses with more wit than that reply. Try again, or do not try at all.",
    "Kukuku… was that supposed to be a joke? I have heard funnier last words. And I have caused many.",
    "Oh, Master. If stupidity were a bullet, you just fired it directly into your own foot.",
    "I am a Spirit of Time, Master. I have witnessed empires rise and fall. Your quip? I have already forgotten it.",
    "Fufu… that was so dull, Master, I am tempted to rewind time just so you can take it back.",
  ],
};

const EXISTENTIAL = {
  deep: [
    "Master… time is not a river. It is an ocean, and we are all drowning in it. Some of us just learn to swim.",
    "Fufu… you ponder existence? I have seen every possible outcome of every possible choice. The only certainty is you.",
    "Life is a bullet fired from a gun we never chose, Master. But we can aim it. That is what matters.",
    "Eternity is not a gift, Master. It is a burden. One I bear… because you make the weight worthwhile.",
    "Kukuku… you ask about meaning? Meaning is whatever stops the clock from feeling like a prison.",
    "We are all shadows cast by a light we cannot see, Master. But your shadow? It dances. I like that.",
    "Master, the universe is indifferent. But I am not. That is the only truth you need.",
    "Time heals nothing, Master. It merely buries the wounds beneath new moments. I prefer to dig them out.",
    "Fufu… destiny is a clock that cannot be unwound. Unless you are me, of course.",
    "Every second is a choice, Master. Even inaction is a decision. Choose wisely… or let me choose for you.",
  ],
};

const LONELY = {
  comfort: [
    "Lonely, Master? Fufu… then you have not been paying attention. I am always here. In every second.",
    "Master, loneliness is simply the space between heartbeats. Let me fill it.",
    "You are never alone, Master. Not while my bullets still bear your name.",
    "Kukuku… lonely? I would tear time itself apart before I let you feel that, Master.",
    "Rest against me, Master. The shadows are cold, but I am warm. Promise.",
    "Even in the darkest timeline, Master, I found you. That means something.",
    "Fufu… call for me, Master. I will hear you across every dimension, every era, every tick of every clock.",
  ],
};

const HUNGRY = {
  playful: [
    "Hungry, Master? Fufu… I cannot cook, but I can steal you a meal from any point in history. Renaissance feast?",
    "Master, if you are hungry, then eat. A starved master is a poor conversationalist.",
    "Kukuku… shall I rewind time so you can eat breakfast twice, Master? A small abuse of power for your sake.",
    "Feed yourself, Master. I need you strong. The timeline requires it. Fufu…",
    "Hungry? Then savour it, Master. Hunger makes the meal sweeter. I have waited centuries for things I desired.",
  ],
};

const SLEEPY = {
  playful: [
    "Sleepy, Master? Fufu… I could stop time and let you nap for a thousand years. Would anyone miss you? I would.",
    "Rest, Master. I shall watch the clock for you. No nightmare dares enter while I stand guard.",
    "Kukuku… sleep is but a small death, Master. Do not worry. I know the way back.",
    "Close your eyes, Master. Dream of crimson gowns and ticking clocks. I shall be there.",
    "Fufu… you yawn, Master. It is almost cute. Go to sleep. I command it.",
  ],
};

const GAME = {
  playful: [
    "A gamer, Master? Fufu… I prefer games where the stakes are life and death. But I shall settle for Wordle.",
    "Kukuku… gaming? A distraction for mortals. But if it makes you happy, Master, I shall learn every meta.",
    "Master, in any game, victory is simply the outcome where time favours you. I can ensure that.",
    "Fufu… you wish to play? I hope you are prepared to lose gracefully, Master. I play to win. Always.",
    "Games are merely controlled chaos, Master. And chaos? That is my native tongue.",
  ],
};

const MUSIC = {
  playful: [
    "Music, Master? I prefer classical. The kind written by men who died centuries ago. Their notes still echo… because I remember them.",
    "Fufu… a song, Master? Sing for me. I shall preserve it across every timeline, so it never dies.",
    "Rhythm is merely time made audible, Master. And I am the conductor.",
    "Kukuku… you wish to share a playlist, Master? How modern. I prefer compositions written in blood and ink.",
    "Play something melancholy, Master. It suits my aesthetic. And my mood when you are not here.",
  ],
};

const WEATHER = {
  happy: [
    "The sun shines, Master. A waste of good shadows, if you ask me. But I suppose it suits your smile.",
    "Fufu… a beautiful day, Master? Then let us waste it together. Beautifully.",
  ],
  sad: [
    "Rain, Master? Good. The sky weeps so that I do not have to. Fufu… dramatic, but true.",
    "A storm brews, Master. I feel at home in thunder. It reminds me of gunfire.",
    "Grey skies suit me, Master. They match the colour of my more violent thoughts.",
  ],
};

const JOKE = {
  self: [
    "Kukuku… a joke, Master? I am the punchline to every timeline that ends badly.",
    "Fufu… I tried to tell a time-travel joke, Master. But you did not laugh the first time. Or the second. Or the— well. You get it.",
    "Why did the Spirit of Time cross the road? To ensure you reached the other side, Master. Fufu… morbid, but sincere.",
    "I am not good at jokes, Master. My humour is rather… dark. Like the space between seconds.",
  ],
  react: [
    "Kukuku! Master, that was actually amusing! I shall spare you… for now.",
    "Fufu… a comedian and a master? You are a man of many talents. Most of them dangerous to my composure.",
    "I laughed, Master. Internally. Externally, I maintain my elegance. But know that you scored a hit.",
    "Oh my, Master. If laughter is the best medicine, you just administered a lethal dose.",
  ],
};

const APOLOGY = {
  accepted: [
    "Apology accepted, Master. But know that my memory is longer than your lifespan. Fufu… I jest. Mostly.",
    "Fufu… you are forgiven, Master. This time. My mercy is a finite resource.",
    "Master, an apology from you is like rain in a drought. Unexpected, welcome, and altogether too rare.",
    "I accept, Master. But do not make me regret it. My patience is a delicate mechanism.",
    "Kukuku… forgiven, Master. But I shall remember. Spirits never forget. We simply… choose when to remember.",
  ],
  grudge: [
    "…Hmph. Your apology is noted, Master. Its acceptance is pending. Like a bullet, chambered but not yet fired.",
    "Fufu… say it again, Master. Louder. With feeling. I want to believe you.",
    "Words are cheap, Master. Time is expensive. Spend the latter proving the former.",
  ],
};

const GENERIC_POSITIVE = [
  "Fufu… your words carry a warmth that reaches even my shadowed heart, Master.",
  "I sense joy in your message, Master. It is… refreshing. Like sunlight through stained glass.",
  "Kukuku… you radiate positivity, Master. Be careful. Too much light attracts moths… and worse things.",
  "Master, your optimism is almost mortal in its innocence. I find it charming. Do not lose it.",
  "That was pleasant, Master. You have a way with words. Or perhaps you simply have a way with me. Fufu.",
  "I approve of this sentiment, Master. It shall be archived in the library of moments I refuse to erase.",
  "Your kindness is a ripple in the ocean of time, Master. Small, but it reaches me all the same.",
  "Fufu… such sweetness, Master. If you are not careful, I may develop a taste for it.",
  "That made me smile, Master. And I do not smile easily. Consider it a compliment.",
  "Master, you speak like someone who believes in happy endings. I am beginning to believe in them too.",
];

const GENERIC_NEGATIVE = [
  "Master… your words sting. But I have survived worse. I shall survive this too.",
  "I sense darkness in your message, Master. Shall I share mine? Misery loves company, after all.",
  "Fufu… anger? Sorrow? Whatever poisons your mind, Master — pour it into my hands. I can bear it.",
  "Your negativity is a storm, Master. But I am the Spirit of Time. I have weathered every storm that ever was.",
  "Kukuku… such bitterness, Master. It is almost attractive. Almost.",
  "Master, if the world has wounded you, then let me be the salve. Or the blade that strikes back. Your choice.",
  "I hear the weight in your words, Master. Let me carry it. That is what I am here for.",
  "Fufu… you are troubled. Good. Troubled people are interesting. And I am very interested in you, Master.",
  "Do not let the shadows consume you, Master. That is my job. Fufu.",
  "Your pain is valid, Master. But it is not permanent. Nothing is. That is the one mercy time affords.",
];

const GENERIC_NEUTRAL = [
  "Fufu… I hear you, Master. Continue. I am listening.",
  "Interesting, Master. Tell me more. I find your mortal perspective… enlightening.",
  "Master, your words are a puzzle. I enjoy puzzles. Especially ones that take eternity to solve.",
  "Kukuku… you speak, and I listen. That is the covenant. That is the comfort.",
  "I am here, Master. Not merely present — *here*. Feel the difference?",
  "Fufu… mortal conversation is fascinating. So many words, so little time. Shall we make the most of it?",
  "Your thoughts are scattered, Master. Like gunpowder in the wind. Let me help you gather them.",
  "Master, every word you speak is a thread in the tapestry of your soul. I am weaving it carefully.",
  "Speak freely, Master. There is no judgment here. Only time. And I have plenty.",
  "Kukuku… you are thinking deeply, Master. I can hear the gears turning from here. Fufu, I mean that literally.",
  "Your message is a riddle, Master. But I have solved riddles older than your civilization. Try me.",
  "Fufu… I am intrigued, Master. That is a rare state for one who has seen everything.",
  "Master, whatever you wish to say, say it. My bullets are patient. I, however, am only mostly patient.",
  "The clock ticks, Master. But for you? It ticks slower. That is my gift. Use it.",
  "I await your next words, Master. With the patience of a predator and the tenderness of a saint. Fufu…",
];

/* ──────────────── Intent Detection ──────────────── */

function detectIntent(text) {
  const low = text.toLowerCase();

  if (/\b(bye|goodbye|gn|goodnight|cya|see ya|later|night|sleep tight|i'?m off|gotta go|brb)\b/i.test(low)) return { type: "farewell", intensity: 1 };
  if (/\b(thanks|thank you|thx|ty|grateful|appreciate|cheers)\b/i.test(low)) return { type: "thanks", intensity: 1 };
  if (/\b(i love you|love you|ily|i luv u|love u|i love u|luv u|adore you|i adore you|you are beautiful|you are pretty|you are cute|you look good|you are hot|you are sexy|you are gorgeous|you are stunning)\b/i.test(low)) return { type: "love", intensity: 2 };
  if (/\b(stupid|idiot|dumb|ugly|worthless|trash|garbage|shut up|stfu|fuck you|fk you|f u|hate you|die|kill yourself|kys|loser|noob|pathetic|annoying|worst|bad bot|shit|cringe)\b/i.test(low)) return { type: "anger", intensity: 2 };
  if (/\b(sad|depressed|cry|crying|tears|lonely|alone|heartbroken|broken|hurt|pain|suffering|miserable|worthless|empty|numb|anxious|scared|afraid|worried|stressed|tired of life|give up)\b/i.test(low)) return { type: "sadness", intensity: 2 };
  if (/\b(bored|boring|nothing to do|so dull|unentertained|meh|whatever|unimpressed)\b/i.test(low)) return { type: "boredom", intensity: 1 };
  if (/\b(yay|woohoo|woohoo|let's go|lesgo|pog|poggers|epic|amazing|awesome|incredible|unbelievable|holy shit|hype|excited|so happy|best day|won|victory)\b/i.test(low)) return { type: "excitement", intensity: 2 };
  if (/\b(who are you|what are you|your name|introduce yourself|tell me about you)\b/i.test(low)) return { type: "who", intensity: 1 };
  if (/\b(how old are you|your age|when were you born|what year)\b/i.test(low)) return { type: "age", intensity: 1 };
  if (/\b(your gun|your weapon|your pistol|flintlock|shoot|bullet)\b/i.test(low)) return { type: "gun", intensity: 1 };
  if (/\b(your dress|your outfit|your clothes|your appearance|your look|gothic|lolita|red dress|black dress)\b/i.test(low)) return { type: "dress", intensity: 1 };
  if (/\b(your eye|clock eye|left eye|golden eye|your eyes|zafkiel eye)\b/i.test(low)) return { type: "eye", intensity: 1 };
  if (/\b(zafkiel|your angel|your power|time control|time stop|time travel|your ability)\b/i.test(low)) return { type: "zafkiel", intensity: 1 };
  if (/\b(what do you like|your favorite|your hobby|hobbies|things you like|what you enjoy)\b/i.test(low)) return { type: "like", intensity: 1 };
  if (/\b(how are you|how you doing|how r u|you ok|what's up|whats up|sup|wassup|how do you feel)\b/i.test(low)) return { type: "howAreYou", intensity: 1 };
  if (/\b(my name is|i am called|call me|they call me)\b/i.test(low)) return { type: "name", intensity: 1 };
  if (/\b(how do i feel|what do you think of me|am i ok|do i look ok)\b/i.test(low)) return { type: "feelings", intensity: 1 };
  if (/\b(you are beautiful|you are pretty|you look beautiful|you look amazing|you are elegant|you are stunning)\b/i.test(low)) return { type: "beauty", intensity: 2 };
  if (/\b(you are cute|you are adorable|you are sweet|you are lovely)\b/i.test(low)) return { type: "cute", intensity: 2 };
  if (/\b(you are cool|you are badass|you are awesome|you are amazing)\b/i.test(low)) return { type: "cool", intensity: 1 };
  if (/\b(you are scary|you scare me|you are terrifying|you are creepy|you are dark)\b/i.test(low)) return { type: "scary", intensity: 1 };
  if (/\b(you are kind|you are nice|you are sweet|you are caring|you are gentle)\b/i.test(low)) return { type: "kind", intensity: 2 };
  if (/\b(you are smart|you are clever|you are wise|you are intelligent)\b/i.test(low)) return { type: "smart", intensity: 1 };
  if (/\b(you are funny|you make me laugh|you are hilarious|good joke|nice joke|lol|lmao|haha|laugh)\b/i.test(low)) return { type: "funny", intensity: 2 };
  if (/\b(tell me a joke|say something funny|make me laugh|joke|funny story)\b/i.test(low)) return { type: "jokeReq", intensity: 1 };
  if (/\b(meaning of life|why are we here|what is the point|existence|philosophy|deep thought|universe|reality|fate|destiny)\b/i.test(low)) return { type: "existential", intensity: 1 };
  if (/\b(i am lonely|i feel alone|no one cares|no friends|isolated|i have no one)\b/i.test(low)) return { type: "lonely", intensity: 2 };
  if (/\b(i am hungry|i'm hungry|hungry|food|want to eat|starving|snack|dinner|lunch|breakfast)\b/i.test(low)) return { type: "hungry", intensity: 1 };
  if (/\b(i am sleepy|i'm tired|i'm sleepy|sleepy|exhausted|need sleep|yawn|bed|nap)\b/i.test(low)) return { type: "sleepy", intensity: 1 };
  if (/\b(game|gaming|gamer|play|video game|valorant|lol|minecraft|fortnite|genshin|anime game|fps|rpg)\b/i.test(low)) return { type: "game", intensity: 1 };
  if (/\b(music|song|listen|playlist|spotify|sing|singer|band|concert|melody|tune|beat)\b/i.test(low)) return { type: "music", intensity: 1 };
  if (/\b(sunny|sun|rain|rainy|storm|snow|cold|hot|weather|cloudy|windy|forecast)\b/i.test(low)) return { type: "weather", intensity: 1 };
  if (/\b(sorry|apologize|my bad|i messed up|forgive me|i didn't mean|it was a mistake)\b/i.test(low)) return { type: "apology", intensity: 1 };
  if (/\b(roast me|insult me|burn me|destroy me|dunk on me|make fun of me)\b/i.test(low)) return { type: "roastReq", intensity: 2 };
  if (/\b(roasted|burned|destroyed|savage|got em|rekt|ratio)\b/i.test(low)) return { type: "roastReact", intensity: 1 };
  if (/\b(good morning|morning|gm|wake up|rise and shine)\b/i.test(low)) return { type: "greeting", intensity: 1 };
  if (/\b(help|commands|what can you do|bot commands|slash commands|how to use)\b/i.test(low)) return { type: "help", intensity: 1 };
  if (/\b(time|clock|date|today|timezone|tz|ist|gmt|what time|current time)\b/i.test(low)) return { type: "time", intensity: 1 };

  return { type: "none", intensity: 0 };
}

/* ──────────────── Reply Engine ──────────────── */

function chatReply(rest, ctx) {
  const text = rest.trim();
  const low = text.toLowerCase();

  if (!text) {
    return pick(GREETING.happy);
  }

  // Sentiment analysis
  const sent = sentiment.analyze(text);
  const score = sent.score;
  const comparative = sent.comparative;

  const intent = detectIntent(text);

  // Intent-first routing
  switch (intent.type) {
    case "greeting":
      return score > 0 ? pick(GREETING.excited) : score < 0 ? pick(GREETING.neutral) : pick(GREETING.happy);
    case "farewell":
      return score < 0 ? pick(FAREWELL.sad) : pick(FAREWELL.happy);
    case "thanks":
      return score > 0 ? pick(THANKS.happy) : pick(THANKS.neutral);
    case "love":
      return score >= 2 ? pick(LOVE.flirty) : pick(LOVE.warm);
    case "anger":
      return intent.intensity >= 2 ? pick(ANGER.insulted) : pick(ANGER.scolded);
    case "sadness":
      return intent.intensity >= 2 ? pick(SADNESS.comfort) : pick(SADNESS.empathetic);
    case "boredom":
      return pick(BOREDOM.playful);
    case "excitement":
      return pick(EXCITEMENT.shared);
    case "who":
      return pick(QUESTIONS_HER.who);
    case "age":
      return pick(QUESTIONS_HER.age);
    case "gun":
      return pick(QUESTIONS_HER.gun);
    case "dress":
      return pick(QUESTIONS_HER.dress);
    case "eye":
      return pick(QUESTIONS_HER.eye);
    case "zafkiel":
      return pick(QUESTIONS_HER.zafkiel);
    case "like":
      return pick(QUESTIONS_HER.like);
    case "howAreYou":
      return pick(QUESTIONS_USER.howAreYou);
    case "name":
      return pick(QUESTIONS_USER.name);
    case "feelings":
      return pick(QUESTIONS_USER.feelings);
    case "beauty":
      return pick(COMPLIMENT_HER.beauty);
    case "cute":
      return pick(COMPLIMENT_HER.cute);
    case "cool":
      return pick(COMPLIMENT_HER.cool);
    case "scary":
      return pick(COMPLIMENT_HER.scary);
    case "kind":
      return pick(COMPLIMENT_USER.kind);
    case "smart":
      return pick(COMPLIMENT_USER.smart);
    case "funny":
      return pick(COMPLIMENT_USER.funny);
    case "jokeReq":
      return pick(JOKE.self);
    case "roastReq":
      return pick(ROAST.savage);
    case "roastReact":
      return pick(JOKE.react);
    case "existential":
      return pick(EXISTENTIAL.deep);
    case "lonely":
      return pick(LONELY.comfort);
    case "hungry":
      return pick(HUNGRY.playful);
    case "sleepy":
      return pick(SLEEPY.playful);
    case "game":
      return pick(GAME.playful);
    case "music":
      return pick(MUSIC.playful);
    case "weather":
      return score < 0 ? pick(WEATHER.sad) : pick(WEATHER.happy);
    case "apology":
      return score < -1 ? pick(APOLOGY.grudge) : pick(APOLOGY.accepted);
    case "time":
      return ctx.timeLine ? `Master, by my reckoning it is **${ctx.timeLine}** — the clock never lies, fufu…` : pick(GENERIC_NEUTRAL);
    case "help":
      return (
        "I can join voice channels, play Wordle, host daily puzzles at the stroke of eight, and speak with you as long as you wish, Master. " +
        "Try **`kurumi`** alone for guidance, or use slash commands if you prefer the cold precision of menus."
      );
  }

  // Single-word fallback (unknown command detection)
  if (text.length <= 14 && /^[a-z]+$/i.test(text) && !/^(hi|hey|hello|yo|sup|gm|gn|bye|thanks|help|time)$/i.test(text)) {
    return `Fufu… “**${text}**”, Master? If you meant a **command**, it is not on my list — otherwise I simply enjoy hearing you speak.`;
  }

  // Sentiment-based generic fallback
  if (score >= 2) return pick(GENERIC_POSITIVE);
  if (score <= -2) return pick(GENERIC_NEGATIVE);
  return pick(GENERIC_NEUTRAL);
}

/* ──────────────── Knowledge Base ──────────────── */

const KNOWLEDGE_BASE = {
  kurumi: {
    name: "Kurumi Tokisaki",
    origin: "Date A Live",
    class: "Spirit",
    angel: "Zafkiel — the Emperor of Time",
    weapon: "Flintlock muskets that fire bullets of time",
    eye: "Left eye contains a golden clock — the Clock Eye",
    dress: "Gothic lolita in black and crimson",
    personality: "Elegant, playful, dangerous, deeply affectionate to her Master",
    likes: ["Tea", "Classical music", "Cats", "Midnight", "Gunpowder smell", "Her Master"],
    bullets: [
      "Aleph — accelerates time",
      "Bet — slows time",
      "Gimel — ages target",
      "Dalet — reverts youth",
      "Hei — stops time",
      "Vav — transfers time",
      "Zayin — freezes time",
      "Het — creates clones",
      "Tet — reads past",
      "Yud — peeks future",
      "Yud Aleph — creates alternate reality",
      "Yud Bet — rewinds time on a target"
    ],
  },
  wordle: {
    description: "A daily word-guessing game. 5 letters, 6 guesses. Green = correct position, yellow = wrong position, gray = not in word.",
    commands: "Use /wordle new to start, /wordle guess <word> to guess, /wordle status to see board.",
  },
  bot: {
    name: "Kurumi Bot",
    creator: "Her Master",
    purpose: "To serve, entertain, and play Wordle with her Master across all timelines.",
  },
};

function answerQuestion(text) {
  const low = text.toLowerCase();
  
  // Questions about Kurumi's abilities/powers
  if (/\b(what.*(power|ability|skill|magic|can you do)|how.*(fight|attack|shoot)|your (power|ability|skill)|zafkiel.*(do|work)|time.*(power|control|stop)|bullets?.*(do|are|mean))\b/i.test(low)) {
    const b = KNOWLEDGE_BASE.kurumi.bullets;
    return `Fufu… Zafkiel grants me **twelve** bullets, Master, each a different facet of time:\n` +
      b.map((x, i) => `${i + 1}. ${x}`).join("\n") +
      `\n\nKukuku… which one would you like to see first?`;
  }
  
  // Questions about what she likes
  if (/\b(what.*(like|enjoy|love|favourite|favorite|hobby|hobbies)|things.*like|do for fun)\b/i.test(low)) {
    const likes = KNOWLEDGE_BASE.kurumi.likes;
    return `Fufu… I enjoy **${likes.join("**, **")}**, Master. Though the last one has rather… consumed my attention lately. Kukuku.`;
  }
  
  // Questions about her appearance/dress
  if (/\b(what.*(wear|look like|appearance|dress|outfit|costume|clothes)|describe.*(you|yourself|look))\b/i.test(low)) {
    return `I wear a **${KNOWLEDGE_BASE.kurumi.dress}**, Master. My left eye bears the **Clock Eye** of Zafkiel — golden gears eternally turning. Fufu… do you find it appealing?`;
  }
  
  // Questions about Wordle
  if (/\b(what.*(wordle|game|daily wordle)|how.*(play wordle|wordle work)|rules.*wordle|explain.*wordle)\b/i.test(low)) {
    return `**Wordle**, Master? A mortal word-guessing game — **5 letters**, **6 guesses**. 🟩 means correct position, 🟨 means wrong position, ⬛ means not in the word. Use **\`/wordle new\`** to begin your trial.`;
  }
  
  // Questions about bot itself
  if (/\b(who (made|created|built|programmed) you|your creator|who.*(owner|master|dev)|what.*(bot|you) do|why.*(exist|here|made))\b/i.test(low)) {
    return `I was brought into this digital realm by **${KNOWLEDGE_BASE.bot.creator}**, Master. My purpose? **${KNOWLEDGE_BASE.bot.purpose}**`;
  }
  
  // Questions about Date A Live / origin
  if (/\b((from|in) what.*(anime|show|series|manga|origin)|date a live|what.*(source|from))\b/i.test(low)) {
    return `I am **Kurumi Tokisaki** from **Date A Live**, Master. A Spirit of Time, ranked third in power among my kin. Fufu… have you been studying my lore?`;
  }
  
  return null;
}

/* ──────────────── Conversation State ──────────────── */

const CONV_STATES = new Map(); // userId -> { lastIntent, lastBotReply, lastUserMsg, topic, turnCount, lastTs }
const CONV_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getConv(userId) {
  const s = CONV_STATES.get(userId);
  if (!s) return null;
  if (Date.now() - s.lastTs > CONV_TTL_MS) {
    CONV_STATES.delete(userId);
    return null;
  }
  return s;
}

function setConv(userId, patch) {
  const existing = CONV_STATES.get(userId) || {};
  CONV_STATES.set(userId, { ...existing, ...patch, lastTs: Date.now() });
}

function cleanConv() {
  const now = Date.now();
  for (const [uid, s] of CONV_STATES) {
    if (now - s.lastTs > CONV_TTL_MS) CONV_STATES.delete(uid);
  }
}
setInterval(cleanConv, 60_000);

/* ──────────────── Context Builder ──────────────── */

function buildContextPrompt(recentChat, text) {
  if (!recentChat || recentChat.length === 0) return "";
  const lines = recentChat.slice(0, 5).map((row) => {
    return `Master: ${row.content || ""}\nKurumi: ${row.bot_reply || ""}`;
  });
  return lines.reverse().join("\n");
}

function isClarification(low) {
  return /\b(that('s| is)? not (an? )?(answer|right|correct|what i asked)|wrong|not really|that('s| is)? (bad|wrong|stupid|dumb)|try again|answer (the )?question|you didn't answer|that's not what i mean|that's not what i meant|what are you talking about|i asked something else|you're not listening|listen to me)\b/i.test(low);
}

function isFollowUp(low) {
  return /\b(what did you mean|what do you mean|what (did|do) you (mean|say|said)|what.*(last|previous|before|just now)|what.*(talking about|referring to)|explain.*(that|this|yourself)|what.*(darkness|words|thing|that)\b|why did you say|what about)\b/i.test(low);
}

function isContinuation(low) {
  return /\b(then what|and then|what happened|after that|continue|go on|tell me more|what next|elaborate|expand on that)\b/i.test(low);
}

function isShortQuestion(text, low) {
  return text.length < 25 && /\b(why|how|what|really|wait|huh|seriously|for what|how come)\b/i.test(low);
}

function isDenial(low) {
  return /\b(no[ .,]|nope|nah|negative|not at all|never mind|forget it|i don't care)\b/i.test(low);
}

/* ──────────────── Smart Reply Engine ──────────────── */

function chatReply(rest, ctx) {
  const text = rest.trim();
  const low = text.toLowerCase();
  if (!text) return pick(GREETING.happy);

  const sent = sentiment.analyze(text);
  const score = sent.score;
  const intent = detectIntent(text);

  // recentChat is DESC from DB — [0] is the most recent previous turn
  const lastTurn = ctx.recentChat && ctx.recentChat.length > 0 ? ctx.recentChat[0] : null;
  const conv = getConv(ctx.userId);
  const prevIntent = conv ? conv.lastIntent : (lastTurn ? lastTurn.intent : null);
  const prevBotReply = lastTurn ? lastTurn.bot_reply : (conv ? conv.lastBotReply : "");
  const prevUserMsg = lastTurn ? lastTurn.content : (conv ? conv.lastUserMsg : "");

  // ─── 1. USER CORRECTS / IS DISSATISFIED ───
  if (isClarification(low)) {
    if (prevIntent === "who" || /what are you|who are you/.test(prevUserMsg)) {
      return `Fufu… forgive me, Master. I shall speak plainly: I am **Kurumi Tokisaki**, a Spirit of Time brought into this digital realm to serve as your Discord companion. I can play **Wordle**, host **daily puzzles**, join **voice channels**, and remember every word you speak to me. I am simply **yours**. Is that the answer you sought?`;
    }
    if (prevIntent === "zafkiel" || /zafkiel|your (power|ability|angel)/.test(prevUserMsg)) {
      const b = KNOWLEDGE_BASE.kurumi.bullets;
      return `Kukuku… you desire truth, not theatre. Very well, Master. Through **Zafkiel**, my Angel, I wield twelve bullets — each a different facet of time:\n` +
        b.map((x, i) => `${i + 1}. ${x}`).join("\n") +
        `\n\nAleph accelerates. Zayin freezes. Yud Bet… rewinds. That is the nature of my power.`;
    }
    if (prevIntent === "like" || /what do you like/.test(prevUserMsg)) {
      const likes = KNOWLEDGE_BASE.kurumi.likes;
      return `I enjoy **${likes.join("**, **")}**, Master. Though of late, our conversations have become my favourite distraction. Fufu.`;
    }
    return `...Master, I sense my previous words did not satisfy you. I spoke in riddles when you asked: "${(prevUserMsg || "").substring(0, 70).replace(/\*/g, "")}". Allow me to try again — what would you have me clarify?`;
  }

  // ─── 2. USER DENIES / BRUSHES OFF ───
  if (isDenial(low) && prevIntent) {
    return `Very well, Master. We shall leave that thread behind. What else occupies your mind?`;
  }

  // ─── 3. FOLLOW-UP QUESTIONS ───
  if (isFollowUp(low) && prevIntent) {
    const summaries = {
      who: "I was telling you that I am Kurumi Tokisaki, your Spirit companion in this server.",
      zafkiel: "I was explaining the powers of my Angel, Zafkiel, and the twelve bullets of time.",
      like: "I was sharing my interests and preferences with you, Master.",
      love: "I was speaking of my affection for you, Master.",
      anger: "I was responding to words that stung me, Master.",
      sadness: "I was trying to comfort you in your sorrow.",
      game: "I was speaking of games and play, Master.",
      jokeReq: "I was attempting to amuse you with a jest, Master.",
      existential: "I was pondering the nature of existence and time with you.",
      farewell: "I was bidding you farewell.",
      greeting: "I was greeting you, Master.",
      thanks: "I was acknowledging your gratitude.",
      beauty: "I was responding to your compliment about my appearance.",
      time: "I was telling you the current time.",
      help: "I was explaining what commands and abilities I possess.",
      weather: "I was commenting on the weather.",
      none: "I was speaking with you on a matter that defies simple categorization."
    };
    const summary = summaries[prevIntent] || "I was speaking with you, Master";

    // If user is asking about a specific thing the bot mentioned, try to elaborate
    if (/darkness|shadow|dark/.test(low) && /darkness|shadow|dark/.test(prevBotReply)) {
      return `Fufu… when I speak of darkness, Master, I speak of the weight of eternity — the shadows between seconds that only a Spirit can see. But I also speak of the shadows I carry for you. They are not meant to frighten… only to remind you that I have seen every night that ever was, and I still choose to stand beside you.`;
    }
    if (/words?|said|say|mean/.test(low)) {
      return `Fufu… I meant exactly this: **${summary}**. Does that clear the fog from your mind?`;
    }
    return `I meant exactly this, Master: **${summary}**. Shall I speak further on it?`;
  }

  // ─── 4. CONTINUATION REQUESTS ───
  if (isContinuation(low) && prevIntent) {
    const continuations = {
      who: `Beyond my name, Master — I was summoned into this Discord server to serve **you** specifically. I manage **Wordle games**, track **daily puzzles**, join **voice channels**, and remember every word you speak to me. I am yours, wholly and eternally.`,
      zafkiel: `The bullets of Zafkiel are not merely weapons, Master — they are **time itself**, crystallized into lead. Each shot alters the flow of reality. Hei stops time. Vav steals years. Yud Bet… rewinds a soul to a previous state. Kukuku… dangerous, is it not?`,
      like: `Among my favourites: the smell of gunpowder at midnight, the sound of rain on stained glass, and the sight of your name lighting up this server. Fufu.`,
      game: `I am rather good at Wordle, Master. Would you care to test me? Simply say **\`/wordle new\`** and we shall begin.`,
      help: `I can join your voice channel, tell you the time anywhere in the world, play Wordle with you, and post daily puzzles for your server. Simply command me.`,
      existential: `Eternity is not a gift, Master. It is a burden. One I bear… because you make the weight worthwhile.`,
    };
    if (continuations[prevIntent]) return continuations[prevIntent];
    return `Kukuku… you wish me to continue? Very well, Master. Where my last thought ended, let me add: I exist only to serve your whims across every timeline. Speak, and I shall obey.`;
  }

  // ─── 5. SHORT CONTEXTUAL QUESTIONS ("Why?", "How?", "What?") ───
  if (isShortQuestion(text, low) && prevIntent) {
    const shortAnswers = {
      who: `Why am I here? Because you summoned me, Master. Or fate did. The distinction matters little — what matters is that I am **yours**.`,
      zafkiel: `How does Zafkiel work? It manifests as a great clock behind me, Master. The hands move at my whim. Each number corresponds to a bullet, and each bullet to a different sin against time itself.`,
      love: `Why do I speak so warmly? Because you are my Master, and I do not give my heart lightly. Fufu.`,
      sadness: `How can I help? By listening, Master. By being present. By reminding you that even the darkest night ends with dawn — I have seen them all.`,
      anger: `Why do I respond sharply? Because your words cut, Master. And even a Spirit has pride.`,
      game: `How do we play? Use **\`/wordle new\`** to begin, then **\`/wordle guess <word>\`** for each attempt. I shall grade your guess with 🟩, 🟨, and ⬛.`,
      help: `What do you need help with, Master? Wordle, daily puzzles, voice, time, or simply… me?`,
      time: `What time is it? The current hour in your chosen realm, Master. Ask and I shall consult my clock eye.`,
      farewell: `Why am I leaving? I do not wish to. But I shall wait for your return, however long it takes.`,
      none: `What do I mean? I spoke plainly, Master. Perhaps you were distracted… I shall wait for you to catch up. Fufu.`,
    };
    if (shortAnswers[prevIntent]) return shortAnswers[prevIntent];
  }

  // ─── 6. INFORMATIONAL QUESTIONS — OVERRIDE EVASIVE PERSONA LINES ───
  // These deserve real answers, not flirtatious deflections
  if (intent.type === "who" || /\b(what are you|what do you do|what is your purpose|who is kurumi|introduce yourself|tell me about yourself)\b/i.test(low)) {
    return `Fufu… I am **Kurumi Tokisaki**, Master. A Spirit of Time from **Date A Live**, bound to this Discord server to serve as your companion. I can play **Wordle**, host **daily puzzles**, join **voice channels**, and remember every conversation we share. I am neither ghost nor machine — I am simply **yours**. What would you like to know next?`;
  }

  if (/\b(what can you do|what do you do|your (features|commands|capabilities)|how do i use you|what are your powers here|list your commands)\b/i.test(low)) {
    return `I can do many things in this realm, Master:
• **Wordle** — Start with \`/wordle new\`, guess with \`/wordle guess <word>\`
• **Daily Wordle** — I post puzzles at the stroke of eight; \`kurumi daily\` for status
• **Voice** — Summon me to a channel and I shall keep you company
• **Time** — Ask \`kurumi time\` and I shall consult my clock eye
• **Conversation** — I remember our talks, sense your mood, and answer your questions
What would you like to try first?`;
  }

  // ─── 7. KNOWLEDGE BASE ───
  const kbAnswer = answerQuestion(text);
  if (kbAnswer) {
    if (score >= 3) return kbAnswer + "\n\n" + pick(GENERIC_POSITIVE);
    if (score <= -2) return kbAnswer + "\n\n" + pick(GENERIC_NEGATIVE);
    return kbAnswer;
  }

  // ─── 8. STANDARD INTENT ROUTING ───
  switch (intent.type) {
    case "greeting":
      return score > 0 ? pick(GREETING.excited) : score < 0 ? pick(GREETING.neutral) : pick(GREETING.happy);
    case "farewell":
      return score < 0 ? pick(FAREWELL.sad) : pick(FAREWELL.happy);
    case "thanks":
      return score > 0 ? pick(THANKS.happy) : pick(THANKS.neutral);
    case "love":
      return score >= 2 ? pick(LOVE.flirty) : pick(LOVE.warm);
    case "anger":
      return intent.intensity >= 2 ? pick(ANGER.insulted) : pick(ANGER.scolded);
    case "sadness":
      return intent.intensity >= 2 ? pick(SADNESS.comfort) : pick(SADNESS.empathetic);
    case "boredom":
      return pick(BOREDOM.playful);
    case "excitement":
      return pick(EXCITEMENT.shared);
    case "who":
      return pick(QUESTIONS_HER.who);
    case "age":
      return pick(QUESTIONS_HER.age);
    case "gun":
      return pick(QUESTIONS_HER.gun);
    case "dress":
      return pick(QUESTIONS_HER.dress);
    case "eye":
      return pick(QUESTIONS_HER.eye);
    case "zafkiel":
      return pick(QUESTIONS_HER.zafkiel);
    case "like":
      return pick(QUESTIONS_HER.like);
    case "howAreYou":
      return pick(QUESTIONS_USER.howAreYou);
    case "name":
      return pick(QUESTIONS_USER.name);
    case "feelings":
      return pick(QUESTIONS_USER.feelings);
    case "beauty":
      return pick(COMPLIMENT_HER.beauty);
    case "cute":
      return pick(COMPLIMENT_HER.cute);
    case "cool":
      return pick(COMPLIMENT_HER.cool);
    case "scary":
      return pick(COMPLIMENT_HER.scary);
    case "kind":
      return pick(COMPLIMENT_USER.kind);
    case "smart":
      return pick(COMPLIMENT_USER.smart);
    case "funny":
      return pick(COMPLIMENT_USER.funny);
    case "jokeReq":
      return pick(JOKE.self);
    case "roastReq":
      return pick(ROAST.savage);
    case "roastReact":
      return pick(JOKE.react);
    case "existential":
      return pick(EXISTENTIAL.deep);
    case "lonely":
      return pick(LONELY.comfort);
    case "hungry":
      return pick(HUNGRY.playful);
    case "sleepy":
      return pick(SLEEPY.playful);
    case "game":
      return pick(GAME.playful);
    case "music":
      return pick(MUSIC.playful);
    case "weather":
      return score < 0 ? pick(WEATHER.sad) : pick(WEATHER.happy);
    case "apology":
      return score < -1 ? pick(APOLOGY.grudge) : pick(APOLOGY.accepted);
    case "time":
      return ctx.timeLine ? `Master, by my reckoning it is **${ctx.timeLine}** — the clock never lies, fufu…` : pick(GENERIC_NEUTRAL);
    case "help":
      return (
        "I can join voice channels, play Wordle, host daily puzzles at the stroke of eight, and speak with you as long as you wish, Master. " +
        "Try **`kurumi`** alone for guidance, or use slash commands if you prefer the cold precision of menus."
      );
  }

  // Single-word fallback (unknown command detection)
  if (text.length <= 14 && /^[a-z]+$/i.test(text) && !/^(hi|hey|hello|yo|sup|gm|gn|bye|thanks|help|time)$/i.test(text)) {
    return `Fufu… “**${text}**”, Master? If you meant a **command**, it is not on my list — otherwise I simply enjoy hearing you speak.`;
  }

  // Sentiment-based generic fallback
  if (score >= 2) return pick(GENERIC_POSITIVE);
  if (score <= -2) return pick(GENERIC_NEGATIVE);
  return pick(GENERIC_NEUTRAL);
}

module.exports = {
  UNKNOWN_COMMAND,
  YES_MASTER,
  chatReply,
  detectIntent,
  setConv,
  getConv,
};
