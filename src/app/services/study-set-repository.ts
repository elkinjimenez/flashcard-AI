import { Injectable } from '@angular/core';
import { Flashcard } from './flashcard.model';
import { toTopicKey } from './topic-key';

// Con qué forma de buscar imágenes se creó el tema. Solo informativo: las imágenes guardadas no se vuelven a buscar
// solas, para no gastar consultas.
// 4: varios candidatos por palabra y Gemini elige el GIF más literal por su título.
const currentImageSearchVersion = 4;

// 4: el id de cada tema pasa a ser su clave normalizada (antes era el texto tal cual).
const databaseVersion = 4;

export interface StoredStudySet {
  id: string;
  topic: string;
  cards: Flashcard[];
  createdAt: string;
  imageSearchVersion?: number;
}

@Injectable({ providedIn: 'root' })
export class StudySetRepository {
  private readonly databaseName = 'flashcards-ai';
  private readonly storeName = 'study-sets';

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

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, databaseVersion);
      request.onupgradeneeded = event => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.storeName)) {
          database.createObjectStore(this.storeName, { keyPath: 'id' });
        } else if (event.oldVersion < 4 && request.transaction) {
          this.migrateToTopicKeys(request.transaction);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Reescribe los temas guardados con su clave normalizada; los que coinciden ("Comida" y "comida") se fusionan.
  private migrateToTopicKeys(transaction: IDBTransaction) {
    const store = transaction.objectStore(this.storeName);
    const request = store.getAll();

    request.onsuccess = () => {
      // Si algo falla se aborta la actualización y los datos se quedan como estaban.
      try {
        const groups = new Map<string, StoredStudySet[]>();
        for (const studySet of request.result as StoredStudySet[]) {
          const id = this.getStudySetId(studySet.topic);
          groups.set(id, [...(groups.get(id) ?? []), studySet]);
        }

        const migrated = [...groups].map(([id, studySets]) => this.mergeStudySets(id, studySets));
        store.clear();
        migrated.forEach(studySet => store.put(studySet));
      } catch (error) {
        console.error('No se pudieron migrar los temas guardados', error);
        transaction.abort();
      }
    };
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
