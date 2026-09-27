import { Injectable, inject } from '@angular/core';
import { AppUpdateService } from './app-update';
import { Flashcard, learnedBox, reviewIntervalDays } from './flashcard.model';
import { toTopicKey } from './topic-key';

// Con qué forma de buscar imágenes se creó el tema. Solo informativo: las imágenes guardadas no se vuelven a buscar
// solas, para no gastar consultas.
// 4: varios candidatos por palabra y Gemini elige el GIF más literal por su título.
const currentImageSearchVersion = 4;

// 4: el id de cada tema pasa a ser su clave normalizada (antes era el texto tal cual).
// 5: se añade la actividad diaria, para las estadísticas.
// 6: las aprendidas tienen repasos de mantenimiento; las de antes se programan (ver scheduleLearnedCards).
const databaseVersion = 6;

export interface StoredStudySet {
  id: string;
  topic: string;
  cards: Flashcard[];
  createdAt: string;
  imageSearchVersion?: number;
}

// Respuestas dadas en un día (fecha local AAAA-MM-DD, ver toDayKey).
export interface DailyActivity {
  date: string;
  answers: number;
  correct: number;
}

// Toda la base de datos local: los temas con sus tarjetas y la actividad diaria.
@Injectable({ providedIn: 'root' })
export class StudySetRepository {
  private appUpdate = inject(AppUpdateService);

  private readonly databaseName = 'flashcards-ai';
  private readonly storeName = 'study-sets';
  private readonly activityStoreName = 'activity';
  private switchingVersion = false;

  async get(topic: string): Promise<StoredStudySet | undefined> {
    const database = await this.openDatabase();
    const record = await new Promise<StoredStudySet | undefined>((resolve, reject) => {
      const transaction = database.transaction(this.storeName, 'readonly');
      const request = transaction.objectStore(this.storeName).get(this.getStudySetId(topic));
      request.onsuccess = () => resolve(request.result as StoredStudySet | undefined);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return record;
  }

  async getAll(): Promise<StoredStudySet[]> {
    const database = await this.openDatabase();
    const studySets = await new Promise<StoredStudySet[]>((resolve, reject) => {
      const transaction = database.transaction(this.storeName, 'readonly');
      const request = transaction.objectStore(this.storeName).getAll();
      request.onsuccess = () => resolve(request.result as StoredStudySet[]);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return studySets;
  }

  async save(topic: string, cards: Flashcard[]): Promise<void> {
    const database = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(this.storeName, 'readwrite');
      transaction.objectStore(this.storeName).put({
        id: this.getStudySetId(topic),
        topic,
        cards,
        createdAt: new Date().toISOString(),
        imageSearchVersion: currentImageSearchVersion
      } satisfies StoredStudySet);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }

  async updateCards(topic: string, update: (cards: Flashcard[]) => Flashcard[]): Promise<void> {
    const database = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      // Lectura y escritura en la misma transacción para que dos llamadas seguidas no se pisen.
      const transaction = database.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(this.getStudySetId(topic));

      request.onsuccess = () => {
        const record = request.result as StoredStudySet | undefined;
        if (!record) return;

        record.cards = update(record.cards);

        // Zone.js se traga las excepciones de este handler: sin el catch, la transacción terminaría "bien" sin guardar.
        try {
          store.put(record);
        } catch (error) {
          reject(error);
          transaction.abort();
        }
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }

  async delete(topic: string): Promise<void> {
    const database = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(this.storeName, 'readwrite');
      transaction.objectStore(this.storeName).delete(this.getStudySetId(topic));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }

  async getActivity(): Promise<DailyActivity[]> {
    const database = await this.openDatabase();
    const activity = await new Promise<DailyActivity[]>((resolve, reject) => {
      const transaction = database.transaction(this.activityStoreName, 'readonly');
      const request = transaction.objectStore(this.activityStoreName).getAll();
      request.onsuccess = () => resolve(request.result as DailyActivity[]);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return activity;
  }

  // Suma respuestas a un día; en negativo, las descuenta (al deshacer).
  async addActivity(date: string, answers: number, correct: number): Promise<void> {
    const database = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(this.activityStoreName, 'readwrite');
      const store = transaction.objectStore(this.activityStoreName);
      const request = store.get(date);

      request.onsuccess = () => {
        const day = (request.result as DailyActivity | undefined) ?? { date, answers: 0, correct: 0 };
        // Igual que en updateCards: sin el catch, un fallo aquí terminaría la transacción "bien" sin guardar.
        try {
          store.put({
            date,
            answers: Math.max(0, day.answers + answers),
            correct: Math.max(0, day.correct + correct)
          } satisfies DailyActivity);
        } catch (error) {
          reject(error);
          transaction.abort();
        }
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, databaseVersion);
      request.onupgradeneeded = event => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.storeName)) {
          database.createObjectStore(this.storeName, { keyPath: 'id' });
        } else if (event.oldVersion < 6 && request.transaction) {
          this.migrateStudySets(request.transaction, event.oldVersion);
        }
        if (!database.objectStoreNames.contains(this.activityStoreName)) {
          database.createObjectStore(this.activityStoreName, { keyPath: 'date' });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        // Otra pestaña abre la versión nueva: cerrar para no bloquear su actualización del esquema.
        database.onversionchange = () => {
          database.close();
          location.reload();
        };
        resolve(database);
      };
      request.onerror = () => {
        // Una versión más nueva de la app ya subió el esquema: esta ventana es vieja.
        if (request.error?.name === 'VersionError' && !this.switchingVersion) {
          this.switchingVersion = true;
          this.appUpdate.switchToNewVersion();
        }
        reject(request.error);
      };
    });
  }

  // Reescribe los temas guardados con los cambios de cada versión desde `oldVersion`. En una sola lectura: otra en la
  // misma transacción leería los datos antes de que la primera los reescriba.
  private migrateStudySets(transaction: IDBTransaction, oldVersion: number) {
    const store = transaction.objectStore(this.storeName);
    const request = store.getAll();

    request.onsuccess = () => {
      // Si algo falla se aborta la actualización y los datos se quedan como estaban.
      try {
        let studySets = request.result as StoredStudySet[];
        if (oldVersion < 4) {
          studySets = this.mergeByTopicKey(studySets);
        }
        studySets = this.scheduleLearnedCards(studySets);

        store.clear();
        studySets.forEach(studySet => store.put(studySet));
      } catch (error) {
        console.error('No se pudieron migrar los temas guardados', error);
        transaction.abort();
      }
    };
  }

  // Con su clave normalizada, los temas que coinciden ("Comida" y "comida") se fusionan.
  private mergeByTopicKey(studySets: StoredStudySet[]): StoredStudySet[] {
    const groups = new Map<string, StoredStudySet[]>();
    for (const studySet of studySets) {
      const id = this.getStudySetId(studySet.topic);
      groups.set(id, [...(groups.get(id) ?? []), studySet]);
    }
    return [...groups].map(([id, group]) => this.mergeStudySets(id, group));
  }

  // Las aprendidas antes de los repasos de mantenimiento pasan a su primera caja, con el repaso que les habría tocado:
  // el intervalo de esa caja desde su último repaso. Si esa fecha ya pasó, o no hay fecha (antes bastaba deslizar una
  // vez para marcarla), se reparten en las dos próximas semanas para que no lleguen todas el mismo día.
  private scheduleLearnedCards(studySets: StoredStudySet[]): StoredStudySet[] {
    const now = new Date();
    let spread = 0;
    const inDays = (from: Date, days: number) => {
      const date = new Date(from);
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + days);
      return date;
    };

    return studySets.map(studySet => ({
      ...studySet,
      cards: studySet.cards.map(card => {
        if (!card.learned || (card.box ?? 0) >= learnedBox) return card;

        const due = card.nextReview ? inDays(new Date(card.nextReview), reviewIntervalDays[learnedBox - 1]) : null;
        const nextReview = due && due > now ? due : inDays(now, 1 + spread++ % 14);
        return { ...card, box: learnedBox, nextReview: nextReview.toISOString() };
      })
    }));
  }

  private mergeStudySets(id: string, studySets: StoredStudySet[]): StoredStudySet {
    // Se queda con el nombre del tema que tenga más palabras.
    const [main] = [...studySets].sort((a, b) => b.cards.length - a.cards.length);
    const cardsByWord = new Map<string, Flashcard>();
    const progressRank = (card: Flashcard) => card.learned ? Number.MAX_SAFE_INTEGER : card.box ?? -1;

    for (const studySet of [main, ...studySets.filter(studySet => studySet !== main)]) {
      for (const card of studySet.cards) {
        const key = card.word.toLowerCase();
        const existing = cardsByWord.get(key);
        // Si la palabra está repetida, se conserva la copia con más progreso.
        if (!existing || progressRank(card) > progressRank(existing)) {
          cardsByWord.set(key, card);
        }
      }
    }

    return {
      id,
      topic: main.topic,
      cards: [...cardsByWord.values()],
      createdAt: studySets.map(studySet => studySet.createdAt).sort()[0],
      imageSearchVersion: Math.min(...studySets.map(studySet => studySet.imageSearchVersion ?? 0))
    };
  }

  private getStudySetId(topic: string): string {
    return toTopicKey(topic);
  }
}
