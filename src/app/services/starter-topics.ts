import { isNewCard } from './flashcard.model';
import type { WordSuggestion } from './gemini';
import type { StoredStudySet } from './study-set-repository';
import { toTopicKey } from './topic-key';

// Temas con los que empieza la app, para no abrirla en blanco: se guardan al crear la base de datos (ver
// StudySetRepository). Vocabulario básico (A1-A2) y muy visual, de lo más común a lo menos. Las imágenes no van aquí:
// se buscan en su primera sesión, como las de cualquier palabra sin imagen (ver retryMissingImages). Las confundibles,
// si están en el mismo tema, salen con su imagen en los ejercicios.
export const starterTopics: ReadonlyArray<{ topic: string; words: WordSuggestion[] }> = [
  {
    topic: 'Comida',
    words: [
      { word: 'apple', translation: 'manzana', example: 'I eat a red apple every morning.', imageQuery: 'red apple fruit', confusables: ['orange', 'grape'] },
      { word: 'bread', translation: 'pan', example: 'She buys fresh bread at the bakery.', imageQuery: 'fresh bread loaf', confusables: ['cake', 'break'] },
      { word: 'egg', translation: 'huevo', example: 'He fries an egg for breakfast.', imageQuery: 'frying egg', confusables: ['chicken', 'milk'] },
      { word: 'milk', translation: 'leche', example: 'The baby drinks warm milk.', imageQuery: 'pouring milk glass', confusables: ['water', 'juice'] },
      { word: 'water', translation: 'agua', example: 'Can I have a glass of water, please?', imageQuery: 'glass of water', confusables: ['milk', 'juice'] },
      { word: 'cheese', translation: 'queso', example: 'I put cheese on my sandwich.', imageQuery: 'cheese slice', confusables: ['chess', 'bread'] },
      { word: 'rice', translation: 'arroz', example: 'We eat rice and chicken for lunch.', imageQuery: 'bowl of rice', confusables: ['ice', 'soup'] },
      { word: 'chicken', translation: 'pollo', example: 'My mom cooks chicken on Sundays.', imageQuery: 'roast chicken', confusables: ['kitchen', 'egg'] },
      { word: 'orange', translation: 'naranja', example: 'She peels an orange for her son.', imageQuery: 'peeling orange fruit', confusables: ['apple', 'carrot'] },
      { word: 'strawberry', translation: 'fresa', example: 'This strawberry is sweet and red.', imageQuery: 'red strawberry fruit', confusables: ['cherry', 'grape'] },
      { word: 'carrot', translation: 'zanahoria', example: 'I cut a carrot for the soup.', imageQuery: 'orange carrot vegetable', confusables: ['parrot', 'potato'] },
      { word: 'tomato', translation: 'tomate', example: 'There is a tomato in my salad.', imageQuery: 'red tomato', confusables: ['potato', 'apple'] },
      { word: 'potato', translation: 'papa', example: 'He cooks a potato in the oven.', imageQuery: 'baked potato', confusables: ['tomato', 'onion'] },
      { word: 'soup', translation: 'sopa', example: 'This soup is very hot.', imageQuery: 'bowl of soup', confusables: ['soap', 'rice'] },
      { word: 'juice', translation: 'jugo', example: 'I drink orange juice at breakfast.', imageQuery: 'orange juice glass', confusables: ['milk', 'water'] },
      { word: 'cake', translation: 'pastel', example: 'We eat a chocolate cake on my birthday.', imageQuery: 'birthday cake', confusables: ['cookie', 'bread'] },
      { word: 'ice cream', translation: 'helado', example: 'The children eat ice cream in summer.', imageQuery: 'ice cream cone', confusables: ['cake', 'cookie'] },
      { word: 'cookie', translation: 'galleta', example: 'Can I have a cookie, please?', imageQuery: 'chocolate chip cookie', confusables: ['cook', 'cake'] },
      { word: 'grape', translation: 'uva', example: 'This grape is green and sweet.', imageQuery: 'bunch of grapes', confusables: ['cherry', 'apple'] },
      { word: 'onion', translation: 'cebolla', example: 'The onion makes me cry.', imageQuery: 'cutting onion', confusables: ['potato', 'garlic'] }
    ]
  },
  {
    topic: 'Animales',
    words: [
      { word: 'dog', translation: 'perro', example: 'The dog runs in the park.', imageQuery: 'dog wagging tail', confusables: ['cat', 'wolf'] },
      { word: 'cat', translation: 'gato', example: 'My cat sleeps on the sofa.', imageQuery: 'cat sleeping', confusables: ['dog', 'cap'] },
      { word: 'bird', translation: 'pájaro', example: 'A small bird sings in the tree.', imageQuery: 'bird singing', confusables: ['duck', 'beard'] },
      { word: 'fish', translation: 'pez', example: 'A small fish swims in the water.', imageQuery: 'fish swimming', confusables: ['dish', 'turtle'] },
      { word: 'horse', translation: 'caballo', example: 'She rides a horse on the farm.', imageQuery: 'horse running', confusables: ['house', 'cow'] },
      { word: 'cow', translation: 'vaca', example: 'The cow eats grass in the field.', imageQuery: 'cow eating grass', confusables: ['horse', 'sheep'] },
      { word: 'pig', translation: 'cerdo', example: 'The pig plays in the mud.', imageQuery: 'pig in mud', confusables: ['big', 'cow'] },
      { word: 'duck', translation: 'pato', example: 'A duck swims in the lake.', imageQuery: 'duck swimming', confusables: ['bird', 'frog'] },
      { word: 'rabbit', translation: 'conejo', example: 'The rabbit eats a carrot.', imageQuery: 'rabbit eating carrot', confusables: ['mouse', 'cat'] },
      { word: 'mouse', translation: 'ratón', example: 'A little mouse eats the cheese.', imageQuery: 'mouse eating cheese', confusables: ['mouth', 'rabbit'] },
      { word: 'monkey', translation: 'mono', example: 'The monkey eats a banana.', imageQuery: 'monkey eating banana', confusables: ['money', 'bear'] },
      { word: 'bear', translation: 'oso', example: 'The bear catches a fish in the river.', imageQuery: 'bear catching fish', confusables: ['beer', 'lion'] },
      { word: 'lion', translation: 'león', example: 'The lion sleeps under a tree.', imageQuery: 'lion roaring', confusables: ['bear', 'line'] },
      { word: 'frog', translation: 'rana', example: 'The frog jumps into the water.', imageQuery: 'frog jumping', confusables: ['fog', 'duck'] },
      { word: 'snake', translation: 'serpiente', example: 'The snake moves slowly in the grass.', imageQuery: 'snake slithering', confusables: ['snack', 'spider'] },
      { word: 'sheep', translation: 'oveja', example: 'The sheep has white wool.', imageQuery: 'white sheep grazing', confusables: ['ship', 'cow'] },
      { word: 'turtle', translation: 'tortuga', example: 'The turtle walks very slowly.', imageQuery: 'turtle walking', confusables: ['turkey', 'frog'] },
      { word: 'bee', translation: 'abeja', example: 'A bee flies from flower to flower.', imageQuery: 'bee on flower', confusables: ['butterfly', 'spider'] },
      { word: 'butterfly', translation: 'mariposa', example: 'A yellow butterfly flies in the garden.', imageQuery: 'butterfly flying', confusables: ['bee', 'butter'] },
      { word: 'spider', translation: 'araña', example: 'There is a spider on the wall.', imageQuery: 'spider on web', confusables: ['bee', 'snake'] }
    ]
  }
];

const starterTopicKeys = new Set(starterTopics.map(({ topic }) => toTopicKey(topic)));

// Si hay temas del usuario: los de inicio sin practicar no cuentan, los tiene cualquiera desde que abre la app.
export function hasOwnStudySets(studySets: StoredStudySet[]): boolean {
  return studySets.some(studySet => !starterTopicKeys.has(studySet.id) || studySet.cards.some(card => !isNewCard(card)));
}
