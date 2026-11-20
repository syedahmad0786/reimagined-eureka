/**
 * Learn content: how a person solves a 6x6x6, as data a screen can render without parsing prose.
 *
 * Every \`moves\`, \`setup\` and \`sameAs\` string is in the app's own notation (parseMoves in
 * src/cube/moves.ts) and uses layer turns only, never a whole-cube rotation. \`setup\`, applied to a
 * solved cube, gives the position the algorithm fixes. tests/learn.test.ts replays every one of them
 * on the move engine and asserts exactly what it does, together with the checkable claims in the prose.
 */

export type FaceWord = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';
export type TurnWord = 'clockwise' | 'anticlockwise' | 'half';

export interface NotationRow {
  notation: string;
  meaning: string;
  /** The face the move is named from. */
  face: FaceWord;
  /** First and last layer that turn, counted from that face; 1 is the outer layer. */
  layers: [number, number];
  turn: TurnWord;
  /** For a quarter turn: the stickers of the turning layers that were on \`from\` end up on \`to\`. */
  carries?: { from: FaceWord; to: FaceWord };
}

/** The same idea as its algorithm with other layers. \`sameAs\` is one move with exactly the same effect. */
export interface LearnVariant {
  id: string;
  label: string;
  moves: string;
  setup?: string;
  sameAs?: string;
}

export interface LearnAlgorithm {
  kind: 'algorithm';
  id: string;
  name: string;
  purpose: string;
  moves: string;
  setup?: string;
  note?: string;
  /** One move with exactly the same effect as \`moves\`. */
  sameAs?: string;
  variants?: LearnVariant[];
}

export type LearnBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'steps'; items: string[] }
  | { kind: 'tip'; text: string }
  | { kind: 'notation'; rows: NotationRow[] }
  | LearnAlgorithm;

export type LearnTopicId = 'reduction' | 'notation' | 'centres' | 'edges' | 'parity' | 'three' | 'handling' | 'recovery';

export interface LearnTopic {
  id: LearnTopicId;
  title: string;
  summary: string;
  blocks: LearnBlock[];
}

export type LearnPhase = 'centres' | 'edges' | 'parity' | '3x3';

export interface PhaseNote {
  title: string;
  goal: string;
  watchFor: string;
  tip: string;
}

/** Names of the app's own controls, as the prose uses them. Change them here if a control is renamed. */
export const UI_WORDS = {
  back: 'Back',
  showTurn: 'Show turn',
  colourCheck: 'colour check',
} as const;

const FLIP_PARITY = "3R2 B2 U2 3L U2 3R' U2 3R U2 F2 3R F2 3L' B2 3R2";
const FLIP_PARITY_SETUP = "3R2 B2 3L F2 3R' F2 U2 3R' U2 3R U2 3L' U2 B2 3R2";
const onLayer = (text: string, layer: string): string => text.replace(/3([RL])/g, layer + '$1' + (layer.includes('-') ? 'w' : ''));

const reduction: LearnTopic = {
  id: 'reduction',
  title: 'The idea: reduce it to a 3x3x3',
  summary: 'Build the centres, pair the edges, then finish it like a 3x3x3.',
  blocks: [
    { kind: 'text', text: 'A 6x6x6 has too many pieces to solve one at a time. So you first join them into bigger pieces that behave like the pieces of a 3x3x3. This is called reduction.' },
    {
      kind: 'steps',
      items: [
        'Centres: make the 4 by 4 block in the middle of every side one colour.',
        'Edge pairing: bring the four pieces of each edge together, so the edge shows one colour on each of its two sides.',
        'The 3x3x3 stage: turn only the outer faces and finish the cube like a 3x3x3.',
      ],
    },
    { kind: 'heading', text: 'What the cube is made of' },
    {
      kind: 'list',
      items: [
        '8 corner pieces, the same as on a 3x3x3.',
        '48 edge pieces, called wings: four on each of the 12 edges.',
        '96 centre pieces: sixteen on each of the 6 sides.',
      ],
    },
    { kind: 'heading', text: 'Why it works' },
    { kind: 'text', text: 'A turn of one outer face moves each centre block as one block and each edge as one group of four. It never splits them. So once they are built, a block acts like one centre of a 3x3x3 and a group acts like one edge.' },
    { kind: 'text', text: 'Any turn that includes an inner layer does split them. That is why the order matters: centres first, then edges, and only outer turns at the end.' },
    { kind: 'text', text: 'Two positions can turn up that a 3x3x3 never shows. They are called parities and each has a fix. Topic 5 explains both.' },
    { kind: 'tip', text: 'The app follows the same three stages and tells you which one you are in.' },
  ],
};

const notation: LearnTopic = {
  id: 'notation',
  title: 'Reading the moves',
  summary: 'What each letter, number and mark in a step means.',
  blocks: [
    { kind: 'text', text: 'Each step is one turn, written as a short code. The letter names a face: U is the top, D the bottom, F the front, B the back, L the left and R the right. Layers are counted from that face, so layer 1 is the outer layer.' },
    { kind: 'heading', text: 'Every form, on the right face' },
    {
      kind: 'notation',
      rows: [
        { notation: 'R', meaning: 'The right face, outer layer only. Quarter turn clockwise, looking at the right face.', face: 'right', layers: [1, 1], turn: 'clockwise' },
        { notation: "R'", meaning: 'The right face, outer layer only. Quarter turn anticlockwise, looking at the right face.', face: 'right', layers: [1, 1], turn: 'anticlockwise' },
        { notation: 'R2', meaning: 'The right face, outer layer only. Half turn.', face: 'right', layers: [1, 1], turn: 'half' },
        { notation: 'Rw', meaning: 'The two outer layers on the right, together. Quarter turn clockwise, looking at the right face.', face: 'right', layers: [1, 2], turn: 'clockwise' },
        { notation: '3Rw', meaning: 'The three outer layers on the right, together. Quarter turn clockwise, looking at the right face.', face: 'right', layers: [1, 3], turn: 'clockwise' },
        { notation: '2R', meaning: 'Only layer 2 counted from the right. Quarter turn clockwise, looking at the right face.', face: 'right', layers: [2, 2], turn: 'clockwise' },
        { notation: '3R', meaning: 'Only layer 3 counted from the right. Quarter turn clockwise, looking at the right face.', face: 'right', layers: [3, 3], turn: 'clockwise' },
        { notation: '2-3Rw', meaning: 'Layers 2 to 3 counted from the right, together. Quarter turn clockwise, looking at the right face.', face: 'right', layers: [2, 3], turn: 'clockwise' },
      ],
    },
    { kind: 'heading', text: 'The parts of a code' },
    {
      kind: 'list',
      items: [
        'A number in front picks one layer: 2R is layer 2 from the right, and the outer layer stays still.',
        'A w means wide: several layers together, starting with the outer one. Rw is two layers and 3Rw is three.',
        'A range such as 2-3 means layers 2 to 3 together, without the outer layer.',
        "A ' at the end means anticlockwise. A 2 at the end means a half turn.",
        'No mark at the end means a quarter turn clockwise.',
      ],
    },
    { kind: 'heading', text: 'The same forms on other faces' },
    {
      kind: 'notation',
      rows: [
        { notation: "U'", meaning: 'The top face, outer layer only. Quarter turn anticlockwise, looking at the top face.', face: 'top', layers: [1, 1], turn: 'anticlockwise' },
        { notation: 'D2', meaning: 'The bottom face, outer layer only. Half turn.', face: 'bottom', layers: [1, 1], turn: 'half' },
        { notation: "Lw'", meaning: 'The two outer layers on the left, together. Quarter turn anticlockwise, looking at the left face.', face: 'left', layers: [1, 2], turn: 'anticlockwise' },
        { notation: '3Uw2', meaning: 'The three outer layers on the top, together. Half turn.', face: 'top', layers: [1, 3], turn: 'half' },
        { notation: '2F', meaning: 'Only layer 2 counted from the front. Quarter turn clockwise, looking at the front face.', face: 'front', layers: [2, 2], turn: 'clockwise' },
        { notation: "3B'", meaning: 'Only layer 3 counted from the back. Quarter turn anticlockwise, looking at the back face.', face: 'back', layers: [3, 3], turn: 'anticlockwise' },
        { notation: '2-3Dw2', meaning: 'Layers 2 to 3 counted from the bottom, together. Half turn.', face: 'bottom', layers: [2, 3], turn: 'half' },
        { notation: "2-3Lw'", meaning: 'Layers 2 to 3 counted from the left, together. Quarter turn anticlockwise, looking at the left face.', face: 'left', layers: [2, 3], turn: 'anticlockwise' },
      ],
    },
    { kind: 'heading', text: 'Which way is clockwise' },
    { kind: 'text', text: 'Clockwise is judged looking straight at the named face. So a clockwise turn of the left face carries the front stickers down, while a clockwise turn of the right face carries them up.' },
    {
      kind: 'notation',
      rows: [
        { notation: 'U', meaning: 'Top face clockwise: the front stickers of that layer move to the left.', face: 'top', layers: [1, 1], turn: 'clockwise', carries: { from: 'front', to: 'left' } },
        { notation: 'D', meaning: 'Bottom face clockwise: the front stickers of that layer move to the right.', face: 'bottom', layers: [1, 1], turn: 'clockwise', carries: { from: 'front', to: 'right' } },
        { notation: 'R', meaning: 'Right face clockwise: the front stickers of that layer move to the top.', face: 'right', layers: [1, 1], turn: 'clockwise', carries: { from: 'front', to: 'top' } },
        { notation: 'L', meaning: 'Left face clockwise: the front stickers of that layer move to the bottom.', face: 'left', layers: [1, 1], turn: 'clockwise', carries: { from: 'front', to: 'bottom' } },
        { notation: 'F', meaning: 'Front face clockwise: the top stickers of that layer move to the right.', face: 'front', layers: [1, 1], turn: 'clockwise', carries: { from: 'top', to: 'right' } },
        { notation: 'B', meaning: 'Back face clockwise: the top stickers of that layer move to the left.', face: 'back', layers: [1, 1], turn: 'clockwise', carries: { from: 'top', to: 'left' } },
        { notation: '3R', meaning: 'An inner layer turns the same way as the face it is counted from: here the front stickers of layer 3 move to the top.', face: 'right', layers: [3, 3], turn: 'clockwise', carries: { from: 'front', to: 'top' } },
      ],
    },
    { kind: 'text', text: 'The app never counts past layer 3. A layer nearer the other side is named from that side, so the fourth layer from the right is written as layer 3 from the left.' },
    { kind: 'tip', text: 'The app never asks you to turn the whole cube. Keep the same side on top and the same side facing you from the first step to the last.' },
  ],
};

const centres: LearnTopic = {
  id: 'centres',
  title: 'Centres',
  summary: 'Make the 4 by 4 middle of every side one colour, on the right sides.',
  blocks: [
    { kind: 'text', text: 'The middle of each side is a 4 by 4 block of 16 centre pieces. The goal of this stage is one colour per block. Edges and corners do not matter yet.' },
    { kind: 'heading', text: 'No fixed centre' },
    { kind: 'text', text: 'On a 3x3x3 the middle piece of each side never moves, so it tells you the colour of that side. A 6x6x6 has no such piece: every centre piece can travel to any side. You decide which colour goes where, and it has to agree with the corners.' },
    {
      kind: 'steps',
      items: [
        'Look at any corner piece. Its three colours are neighbours, so none of them is opposite another.',
        'The colour opposite a given colour is the one colour that never shares a corner piece with it.',
        'Around each corner, the three centres must show the colours of that corner piece in the same clockwise order.',
      ],
    },
    { kind: 'text', text: 'If two centres are built on each other\'s sides, most corners no longer fit anywhere and the cube cannot be finished. The app reads the colour scheme from the corners in your scan, so in the guided solve the centres always land on the right sides.' },
    { kind: 'tip', text: 'On most cubes white is opposite yellow, red opposite orange and blue opposite green. Check your own corners rather than trusting this.' },
    { kind: 'heading', text: 'Bars' },
    { kind: 'text', text: 'Build a centre from bars: lines of four pieces of one colour. Four bars side by side make a centre.' },
    { kind: 'text', text: 'The 16 places of a block come in four kinds, four of each: the middle four, the four corners of the block, and two mirror-image kinds along its sides. A piece only ever moves to places of its own kind. So look for a piece that sits in the same kind of place as the gap you want to fill.' },
    { kind: 'heading', text: 'The order to build them' },
    {
      kind: 'steps',
      items: [
        'First centre: nothing is finished yet, so any turn is allowed. Make bars of one colour and bring them together on one side with inner layers.',
        'Second centre: build the opposite colour on the opposite side. Use the exchange below so that every inner layer you turn comes back.',
        'Third and fourth centres: hold the two finished centres on the left and right. Inner layers counted from the left or right, and turns of the top, front, bottom and back faces, cannot touch them.',
        'Last two centres: only the exchange is needed. It trades bars between the two unfinished sides and puts everything else back.',
      ],
    },
    { kind: 'heading', text: 'The three-move exchange' },
    {
      kind: 'algorithm',
      id: 'centre-exchange',
      name: 'Exchange a bar between front and top',
      purpose: 'Swaps an upright bar on the front with an upright bar on the top. The other four centres end up exactly as they were.',
      moves: "3R U2 3R'",
      setup: "3R U2 3R'",
      note: 'Slice up, half turn the top, slice back. The bar in layer 3 from the right lands in layer 3 from the left on the top, and the bar that was there comes down. For layer 2 use 2R in place of 3R; on the left side use 3L\' U2 3L or 2L\' U2 2L.',
      variants: [
        { id: 'centre-exchange-2r', label: 'The bar in layer 2 from the right', moves: "2R U2 2R'", setup: "2R U2 2R'" },
        { id: 'centre-exchange-3l', label: 'The bar in layer 3 from the left', moves: "3L' U2 3L", setup: "3L' U2 3L" },
        { id: 'centre-exchange-2l', label: 'The bar in layer 2 from the left', moves: "2L' U2 2L", setup: "2L' U2 2L" },
        { id: 'centre-exchange-two', label: 'Two bars at once, layers 2 and 3 from the right', moves: "2-3Rw U2 2-3Rw'", setup: "2-3Rw U2 2-3Rw'" },
      ],
    },
    {
      kind: 'steps',
      items: [
        'Turn the front face until the bar you want to send up stands upright in the right half.',
        'Turn the top face until a bar you do not need is in the mirror place: the same layer number, counted from the left.',
        'Do the exchange with that layer number.',
      ],
    },
    { kind: 'tip', text: 'The slice must come back by exactly as much as it went. If you leave out the last move, four centres stay broken.' },
    { kind: 'text', text: 'The exchange also moves edge and corner pieces of the top layer and a few wings. That does not matter during the centres stage, but it means you cannot use it once the edges are paired.' },
    { kind: 'heading', text: 'A trick for single pieces' },
    {
      kind: 'algorithm',
      id: 'centre-three-cycle',
      name: 'Move three centre pieces and nothing else',
      purpose: 'Takes one piece of the middle four from the front up to the top and brings one down in return. Every other piece of the cube stays exactly where it was, except one more front piece that shifts sideways.',
      moves: "3R U' 3L' U 3R' U' 3L U",
      setup: "U' 3L' U 3R U' 3L U 3R'",
      note: 'Eight moves, safe at any stage, even after the edges are paired. Change the two layer numbers to reach the other kinds of place.',
      variants: [
        { id: 'centre-three-cycle-corner', label: 'A corner of the block', moves: "2R U' 2L' U 2R' U' 2L U", setup: "U' 2L' U 2R U' 2L U 2R'" },
        { id: 'centre-three-cycle-side-a', label: 'A side place of one kind', moves: "3R U' 2L' U 3R' U' 2L U", setup: "U' 2L' U 3R U' 2L U 3R'" },
        { id: 'centre-three-cycle-side-b', label: 'A side place of the mirror kind', moves: "2R U' 3L' U 2R' U' 3L U", setup: "U' 3L' U 2R U' 3L U 2R'" },
      ],
    },
  ],
};

const edges: LearnTopic = {
  id: 'edges',
  title: 'Edge pairing',
  summary: 'Bring the four pieces of each edge together without breaking the centres.',
  blocks: [
    { kind: 'text', text: 'Each of the 12 edges holds four pieces called wings. The goal is to bring the four wings with the same two colours together on one edge, all facing the same way. A finished edge is called an edge group.' },
    { kind: 'heading', text: 'Outer and inner wings' },
    {
      kind: 'list',
      items: [
        'The two wings next to the corners are outer wings. The two in the middle are inner wings.',
        'An outer wing can only ever sit in an outer place, and an inner wing in an inner place.',
        'A wing fits each place only one way round. If it looks flipped next to its partners, it belongs at the other end of the edge.',
      ],
    },
    { kind: 'heading', text: 'Slice, replace, slice back' },
    { kind: 'text', text: 'The centres are finished, so every inner turn has to be undone. The trick is to do something useful in between. While an inner layer is turned away you swap whole edges with outer turns, then you turn the layer back.' },
    {
      kind: 'steps',
      items: [
        'Find a wing and the edge it belongs to. With outer turns, put the edge at the front-right and the wing on the back-right, at the same height as its gap.',
        'Turn the top face until an unfinished edge is at the top-back. It will be swapped in.',
        'Slice: turn the inner layer that holds the wing so that the wing comes round to the front-right and joins its group.',
        "Replace: do R U R'. The finished group goes up to the top-front and the unfinished edge takes its place.",
        'Slice back: turn the inner layer back. The centres are whole again.',
      ],
    },
    {
      kind: 'algorithm',
      id: 'edge-slice-replace',
      name: 'Slice, replace, slice back',
      purpose: 'Joins a wing from the back-right edge to its group on the front-right edge, stores that group on the top, and repairs the centres.',
      moves: "3U R U R' 3U'",
      setup: "3U R U' R' 3U'",
      note: 'This is the case for a wing in layer 3 from the top. Use the layer the wing is in: 2U and 2U\' for layer 2 from the top, 3D\' and 3D or 2D\' and 2D near the bottom.',
      variants: [
        { id: 'edge-slice-replace-2u', label: 'A wing in layer 2 from the top', moves: "2U R U R' 2U'", setup: "2U R U' R' 2U'" },
        { id: 'edge-slice-replace-3d', label: 'A wing in layer 3 from the bottom', moves: "3D' R U R' 3D", setup: "3D' R U' R' 3D" },
        { id: 'edge-slice-replace-2d', label: 'A wing in layer 2 from the bottom', moves: "2D' R U R' 2D", setup: "2D' R U' R' 2D" },
      ],
    },
    { kind: 'tip', text: "While a layer is turned away, each side centre has a stripe out of place. A replacing move must turn every side face back by as much as it turned it, as R U R' does. Otherwise the stripes will not line up when you slice back." },
    { kind: 'tip', text: 'Outer turns never split a finished group, so use them freely to line things up before you slice.' },
    { kind: 'heading', text: 'Turning an edge over' },
    {
      kind: 'algorithm',
      id: 'edge-flip',
      name: 'Turn the front-right edge over',
      purpose: 'Turns the front-right edge over where it sits, so every wing on it moves to the other end. The centres stay whole and no group is split.',
      moves: "R U R' F R' F' R",
      setup: "R' F R F' R U' R'",
      note: 'Outer turns only. It also moves the four top edges round and shuffles some corners, which does not matter during pairing.',
    },
    { kind: 'heading', text: 'The last two edges' },
    { kind: 'text', text: 'When only two edges are unpaired there is no spare edge to swap in. Use the same idea with a different middle: slice, turn the front-right edge over, slice back.' },
    {
      kind: 'algorithm',
      id: 'last-two-edges',
      name: 'Last two edges',
      purpose: 'Trades one wing between the front-left and front-right edges and leaves both paired. Every other edge group stays whole, and so do the centres.',
      moves: "3U' R U R' F R' F' R 3U",
      setup: "3U' R' F R F' R U' R' 3U",
      note: 'The wing in layer 3 from the top on the left goes to layer 3 from the bottom on the right, and the wing that was there goes back the other way. The rest of the right edge is turned over. For outer wings use 2U\' and 2U; for an outer and an inner wing together use 2-3Uw\' and 2-3Uw.',
      variants: [
        { id: 'last-two-edges-outer', label: 'Outer wings, layer 2 from the top', moves: "2U' R U R' F R' F' R 2U", setup: "2U' R' F R F' R U' R' 2U" },
        { id: 'last-two-edges-both', label: 'Two wings each, layers 2 and 3 from the top', moves: "2-3Uw' R U R' F R' F' R 2-3Uw", setup: "2-3Uw' R' F R F' R U' R' 2-3Uw" },
      ],
    },
    {
      kind: 'steps',
      items: [
        'Hold the two unpaired edges at the front-left and front-right.',
        'Find the inner wing on the left edge that belongs to the right edge. Imagine sliding it straight across the front at its own height: it should then match the outer wings of the right edge.',
        'The wing the left edge needs should be on the right edge at the mirror height. If one is in layer 3 from the top, the other is in layer 3 from the bottom.',
        'If neither is true, turn the front-right edge over first and look again.',
        "If only one is true, you have the first parity from the next topic. Take the right edge to the top-front with F', swap its two inner wings with that algorithm, bring it back with F and look again.",
        'When both are true, do the algorithm.',
      ],
    },
    { kind: 'text', text: 'For outer wings it works the same way with layer 2, and the sliding wing should match the inner wings of the right edge.' },
    { kind: 'text', text: 'Sometimes just one edge is left, with its inner wings facing against its outer wings. Nothing went wrong: that is the same parity, and the next topic has the fix.' },
    { kind: 'heading', text: 'How the app does it' },
    { kind: 'text', text: 'The app pairs edges the same way but plans many steps ahead. It keeps inner layers turned away for longer and swaps several edges before it slices back. So the centres look broken for most of this stage, and they are whole again before the final stage.' },
  ],
};

const parity: LearnTopic = {
  id: 'parity',
  title: 'The two parities',
  summary: 'Two positions a 3x3x3 never shows, why they happen and how to fix them.',
  blocks: [
    { kind: 'text', text: 'A parity is a position that looks almost done but cannot be finished with the moves of that stage. An even cube such as the 6x6x6 has two. Neither is a mistake, and each has a fix.' },
    { kind: 'heading', text: 'First parity: one edge with flipped wings' },
    { kind: 'text', text: 'It shows at the end of pairing. Eleven edges are done, and on the last one the inner wings face against the outer wings. On a 6x6x6 it comes in two forms: either the two inner wings must trade places, or the two outer wings must.' },
    { kind: 'text', text: 'A quarter turn of an inner layer moves four wings of one kind round in a ring and no others of that kind. That equals three swaps, an odd number. Outer turns and every pairing move make an even number of swaps.' },
    { kind: 'text', text: 'So if the scramble left one kind of wing a single swap out, pairing can never mend it. A 3x3x3 has only one piece per edge, so there is nothing inside an edge to swap.' },
    {
      kind: 'algorithm',
      id: 'flip-parity-inner',
      name: 'Swap the two inner wings',
      purpose: 'Swaps the two inner wings of the top-front edge. Nothing else on the cube changes.',
      moves: FLIP_PARITY,
      setup: FLIP_PARITY_SETUP,
      note: 'Fifteen turns, but only inner layers 3 from the right and left and half turns of the top, front and back. For the two outer wings, use layer 2 in place of layer 3 all the way through. To turn the whole group over, turn layers 2 and 3 together each time.',
      variants: [
        { id: 'flip-parity-outer', label: 'Swap the two outer wings', moves: onLayer(FLIP_PARITY, '2'), setup: onLayer(FLIP_PARITY_SETUP, '2') },
        { id: 'flip-parity-whole', label: 'Turn the whole edge group over', moves: onLayer(FLIP_PARITY, '2-3'), setup: onLayer(FLIP_PARITY_SETUP, '2-3') },
      ],
    },
    { kind: 'text', text: 'By eye the two forms look the same: the inner pair disagrees with the outer pair. Use either version to finish the pairing. If one whole edge group then turns out flipped in the 3x3x3 stage, that is the same parity again, and the version with layers 2 and 3 together fixes it.' },
    { kind: 'text', text: 'The app never meets this parity. Before it starts it checks whether each kind of wing is an odd number of swaps from solved. Then it chooses its centre moves so that the inner layers make the matching number of quarter turns, which evens things out before pairing begins.' },
    { kind: 'heading', text: 'Second parity: two edge groups swapped' },
    { kind: 'text', text: 'It shows at the very end of the 3x3x3 stage. Everything is solved except two edge groups that have traded places. On a 3x3x3 two edges never swap on their own: two corners always swap with them.' },
    { kind: 'text', text: 'On a 6x6x6 swapping two edge groups really swaps four pairs of wings: two outer pairs and two inner pairs. That is an even number of swaps of each kind, so the cube allows it. Whether you get it is down to chance, and about half of all solves do.' },
    {
      kind: 'algorithm',
      id: 'swap-parity',
      name: 'Swap two opposite top edges',
      purpose: 'Swaps the top-front and top-back edge groups. Nothing else on the cube changes.',
      moves: '2-3Rw2 U2 2-3Rw2 3Uw2 2-3Rw2 2-3Uw2',
      setup: '2-3Uw2 2-3Rw2 3Uw2 2-3Rw2 U2 2-3Rw2',
      note: 'Six half turns. The app\'s own fix is the same except that its last turn is 3Uw2, which leaves the top face a half turn round for the 3x3x3 stage to deal with.',
    },
    { kind: 'text', text: 'If the two swapped groups sit next to each other instead of opposite, do the algorithm anyway. It puts corners and edges back in step, and normal 3x3x3 moves can then finish.' },
    { kind: 'text', text: 'The app does not wait for the end. Straight after pairing it checks whether corners and edge groups are in step, and if they are not it plays the fix there, before the 3x3x3 stage.' },
    { kind: 'tip', text: 'Both fixes turn inner layers, yet they leave every centre whole and every other edge group paired. That is what makes them safe this late in a solve.' },
  ],
};

const three: LearnTopic = {
  id: 'three',
  title: 'The 3x3x3 stage',
  summary: 'Finish with turns of single outer faces only.',
  blocks: [
    { kind: 'text', text: 'Now treat each centre block as one centre and each edge group as one edge, and solve the cube as a 3x3x3. If you already know a 3x3x3 method, it works here unchanged.' },
    { kind: 'heading', text: 'Which turns are safe' },
    {
      kind: 'list',
      items: [
        'Safe: a turn of one outer face on its own, any of the six, by a quarter or a half.',
        'Not safe: any turn that includes an inner layer, such as 2R, Rw or 3Uw2. It splits centres and edge groups.',
      ],
    },
    { kind: 'text', text: 'In this stage the app shows only single outer faces: one letter with no number in front and no w.' },
    { kind: 'tip', text: 'Grip only the outer layer. On a big cube it is easy to drag the second layer along by accident, and that undoes the pairing.' },
    { kind: 'text', text: 'If one edge group is flipped or two are swapped at the very end, that is a parity and not a mistake. Topic 5 has the fix for each.' },
  ],
};

const handling: LearnTopic = {
  id: 'handling',
  title: 'Handling a big cube',
  summary: 'Turning cleanly so that nothing locks or pops.',
  blocks: [
    { kind: 'heading', text: 'Line up before you turn' },
    { kind: 'text', text: 'A 6x6x6 locks when its layers are not square to each other. Before every turn, check that the last one was finished: the rows should run in straight lines all the way round.' },
    {
      kind: 'list',
      items: [
        'Finish each turn fully. A layer left a little off blocks the next turn.',
        'If a turn feels stiff, stop. Wiggle the layers square and try again.',
        'Never force it. Forcing a turn that is out of line is how pieces pop out.',
      ],
    },
    { kind: 'heading', text: 'Grip' },
    {
      kind: 'list',
      items: [
        'Outer face: hold the rest of the cube firmly and turn the single layer.',
        'Wide turn, such as Rw or 3Rw: lay your fingers across all the layers that move and turn them as one block, while the other hand or the table holds the rest.',
        'Inner layer on its own, such as 3R: this is the awkward one. Do it as two wide turns, as shown below.',
      ],
    },
    {
      kind: 'algorithm',
      id: 'inner-as-two-wide',
      name: 'An inner layer in two easy turns',
      purpose: 'Turns only layer 3 from the right without gripping it on its own: turn three layers, then turn the outer two back.',
      moves: "3Rw Rw'",
      sameAs: '3R',
      note: 'The result is exactly the same as 3R. The app still counts it as one step, so tell it you are done only after both turns.',
      variants: [
        { id: 'inner-as-two-wide-2', label: 'Layer 2 on its own', moves: "Rw R'", sameAs: '2R' },
        { id: 'inner-as-two-wide-23', label: 'Layers 2 and 3 together', moves: "3Rw R'", sameAs: '2-3Rw' },
      ],
    },
    { kind: 'tip', text: 'You need both hands for inner and wide turns. Put the phone down or prop it up; the app waits for you.' },
    { kind: 'heading', text: 'Go slowly and check' },
    {
      kind: 'steps',
      items: [
        'Read the whole step first: which face, which layers, which way.',
        'Count the layers with a finger before you grip.',
        'Make the turn, then compare your cube with the picture before you go on.',
      ],
    },
    { kind: 'heading', text: 'If a piece pops out' },
    {
      kind: 'steps',
      items: [
        'Stop turning.',
        'Push the piece back into the hole it came from, the same way round. Turning a neighbouring layer slightly can open the hole.',
        'If you are not sure it went back the same way, do not carry on with the steps. Scan the cube again instead.',
      ],
    },
    { kind: 'text', text: 'Almost any way of putting pieces back still gives a cube that can be solved. The one exception is a corner twisted in its place. The ' + UI_WORDS.colourCheck + ' names it, and you fix it by twisting that corner back by hand.' },
  ],
};

const recovery: LearnTopic = {
  id: 'recovery',
  title: 'When the cube does not match',
  summary: 'Finding a wrong turn, and when to scan again.',
  blocks: [
    { kind: 'text', text: 'Sooner or later a turn goes wrong: the wrong layer, the wrong way, or a quarter instead of a half. The picture shows what your cube should look like before the step on screen. As soon as yours differs, stop.' },
    { kind: 'heading', text: 'Find the wrong turn' },
    {
      kind: 'steps',
      items: [
        'Make no more turns.',
        'If you have already moved on to the next step, press ' + UI_WORDS.back + ' once. The picture now shows the cube as it was before your last turn.',
        'Undo your last turn on the cube so that it matches the picture again. Drag the picture round to compare every side.',
        'If you are not sure what you turned, look for the layer whose stickers differ from the picture and turn it until everything matches.',
        'Press ' + UI_WORDS.showTurn + ' to watch the step, then do it again.',
      ],
    },
    {
      kind: 'list',
      items: [
        'Turned the right layer the wrong way? Give it a half turn and it is where the step wanted it.',
        'Turned a quarter when the step wanted a half? Turn it one more quarter the same way.',
        'Turned one layer too many or too few? Turn back only the layer that should not have moved, or add the one you missed.',
      ],
    },
    { kind: 'tip', text: 'A good checkpoint is the start of the final 3x3x3 stage. Every centre is one colour and every edge is paired, in the picture and on your cube.' },
    { kind: 'heading', text: 'When to scan again' },
    {
      kind: 'list',
      items: [
        'You have gone back a few steps and the cube still does not match the picture.',
        'A piece popped out and you are not sure how it went back.',
        'You followed every step and the cube still drifted away from the picture. A sticker may have been read wrongly.',
      ],
    },
    { kind: 'text', text: 'Go back to the ' + UI_WORDS.colourCheck + ' and scan the cube as it is now. You do not need to scramble or reset it: the app solves it from any position.' },
    { kind: 'text', text: 'The ' + UI_WORDS.colourCheck + ' catches most scan mistakes, because a wrong sticker usually makes an impossible piece. One kind slips through: two centre stickers in the same kind of place, read the wrong way round, still describe a real cube. Then the steps are right for the scanned cube but not for yours.' },
  ],
};

/** The eight topics, in reading order. */
export const LEARN_TOPICS: LearnTopic[] = [reduction, notation, centres, edges, parity, three, handling, recovery];

/** For each phase of the guided solve: what it achieves, what you will see, and one practical tip. */
export const PHASE_NOTES: Record<LearnPhase, PhaseNote> = {
  centres: {
    title: 'Centres',
    goal: 'Make the 4 by 4 middle of every side one colour.',
    watchFor: 'Inner layers and blocks of layers turn. One colour gathers on each side while the edges get mixed up, which is fine.',
    tip: 'Count the layers from the named face before you grip. After each turn, compare the stickers that moved with the picture.',
  },
  edges: {
    title: 'Edge pairing',
    goal: 'Bring the four pieces of each edge together so that they match.',
    watchFor: 'Inner layers stay turned away for many steps, so the centres look broken for most of this stage. They are whole again before the final stage.',
    tip: 'Do not try to mend the centres yourself. Follow the steps exactly and the app puts them back.',
  },
  parity: {
    title: 'Parity fix',
    goal: 'Swap two edge groups that pairing left in each other\'s places. No 3x3x3 move can do this.',
    watchFor: 'About six turns, mostly half turns, of inner layers and the top. Afterwards every centre and edge is whole again.',
    tip: 'A half turn can go either way round, so pick the comfortable one. Make sure each goes the full half.',
  },
  '3x3': {
    title: 'Final 3x3 stage',
    goal: 'Finish the cube like a 3x3x3, using the centre blocks and edge groups you built.',
    watchFor: 'Only single outer faces turn. No centre or edge group is split again.',
    tip: 'Grip just the outer layer. If the second layer comes along by accident, turn it straight back.',
  },
};
