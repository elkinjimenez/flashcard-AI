import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StudySetupPage } from './study-setup.page';

describe('StudySetupPage', () => {
  let component: StudySetupPage;
  let fixture: ComponentFixture<StudySetupPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(StudySetupPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
