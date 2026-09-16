import { TestBed } from '@angular/core/testing';

import { Flashcard } from './flashcard';

describe('Flashcard', () => {
  let service: Flashcard;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Flashcard);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
