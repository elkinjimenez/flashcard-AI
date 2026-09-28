import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Gesture, GestureController, IonIcon, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { libraryOutline, settingsOutline, statsChartOutline, todayOutline } from 'ionicons/icons';

// Arrastre del contenido entre pestañas: la página actual y, si la hay, la vecina que asoma a su lado.
interface Drag {
  current: HTMLElement;
  width: number;
  neighborTab?: string;
  neighbor?: HTMLElement;
  released?: boolean;
}

// Tantas como --tab-count en tabs.page.scss.
const tabs = ['today', 'topics', 'progress', 'settings'];
const tabsPrefix = '/tabs/';
const slideTransition = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)';

// Pantallas principales, con una barra flotante de vidrio. Se cambia de pestaña tocando un icono, arrastrando el dedo
// por la barra o deslizando el contenido de lado, como un carrusel. La práctica queda fuera: ocupa toda la pantalla.
@Component({
  selector: 'app-tabs',
  standalone: true,
  imports: [IonTabs, IonTabBar, IonTabButton, IonIcon],
  templateUrl: './tabs.page.html',
  styleUrls: ['./tabs.page.scss'],
})
export class TabsPage implements AfterViewInit, OnDestroy {
  private router = inject(Router);
  private element: HTMLElement = inject(ElementRef).nativeElement;
  private gestureController = inject(GestureController);
  @ViewChild(IonTabs) private ionTabs!: IonTabs;

  // Pestaña que se está mostrando (o a la que se va): mueve el indicador.
  currentTab = tabs[0];
  // Al abrir se crean todas las pestañas sin enseñarlas, para que al deslizar la vecina ya exista (ver onTabShown).
  private preload: 'pending' | 'running' | 'done' = 'pending';
  private initialTab = '';
  private swipe?: Gesture;
  private drag?: Drag;
  private draggingOnBar = false;

  constructor() {
    addIcons({ libraryOutline, settingsOutline, statsChartOutline, todayOutline });
  }

  get currentIndex(): number {
    return Math.max(tabs.indexOf(this.currentTab), 0);
  }

  ngAfterViewInit() {
    // Oculto hasta terminar la precarga: si no, se verían pasar las pestañas.
    this.element.style.visibility = 'hidden';
    this.swipe = this.gestureController.create({
      el: this.element,
      gestureName: 'swipe-tabs',
      direction: 'x',
      threshold: 15,
      disableScroll: true,
      // Ni sobre la barra (tiene su propio arrastre) ni sobre los selectores de Temas (ion-segment también se arrastra).
      canStart: detail => this.preload === 'done' && !this.drag
        && !(detail.event.target as Element).closest('ion-tab-bar, ion-segment'),
      onStart: () => this.startDrag(),
      onMove: detail => this.moveDrag(detail.deltaX),
      onEnd: detail => void this.releaseDrag(detail.deltaX, detail.velocityX),
    });
    this.swipe.enable();
  }

  ngOnDestroy() {
    this.swipe?.destroy();
  }

  onTabWillChange(tab: string) {
    if (this.preload !== 'running') this.currentTab = tab;
  }

  async onTabShown(tab: string) {
    if (this.preload === 'pending') {
      this.preload = 'running';
      this.initialTab = tab;
      for (const other of tabs) {
        if (!this.view(other)) await this.router.navigateByUrl(tabsPrefix + other, { skipLocationChange: true });
      }
      if (this.router.url === tabsPrefix + tab) {
        this.finishPreload();
      } else {
        await this.router.navigateByUrl(tabsPrefix + tab, { skipLocationChange: true });
      }
    } else if (this.preload === 'running') {
      if (tab === this.initialTab) this.finishPreload();
    } else if (this.drag?.released) {
      // Ya en la vecina: fuera los estilos del arrastre.
      this.clearStyles(this.drag.current);
      if (this.drag.neighbor) this.clearStyles(this.drag.neighbor);
      this.drag = undefined;
    }
  }

  // Ionic navegaría por su cuenta: aquí se navega igual que al arrastrar, y se ignora durante la precarga o un arrastre.
  onTabButtonClick(event: Event) {
    event.stopPropagation();
    this.goToTab((event as CustomEvent<{ tab: string }>).detail.tab);
  }

  onBarTouchStart(event: TouchEvent) {
    this.draggingOnBar = true;
    this.selectAtX(event.touches[0].clientX, event.currentTarget as HTMLElement);
  }

  onBarTouchMove(event: TouchEvent) {
    if (this.draggingOnBar) {
      this.selectAtX(event.touches[0].clientX, event.currentTarget as HTMLElement);
    }
  }

  onBarTouchEnd() {
    this.draggingOnBar = false;
  }

  // La pestaña bajo el dedo, al arrastrarlo por la barra.
  private selectAtX(x: number, tabBar: HTMLElement) {
    const rect = tabBar.getBoundingClientRect();
    const index = Math.floor((x - rect.left) / (rect.width / tabs.length));
    if (index >= 0 && index < tabs.length) this.goToTab(tabs[index]);
  }

  private finishPreload() {
    this.preload = 'done';
    this.element.style.removeProperty('visibility');
  }

  private view(tab: string) {
    return this.ionTabs.outlet.getLastRouteView(tab);
  }

  private startDrag() {
    const current = this.view(this.currentTab)?.element;
    if (current) this.drag = { current, width: this.element.clientWidth };
  }

  // La página sigue al dedo y la vecina asoma por el lado contrario. En la primera y la última, resistencia: sin vecina,
  // se mueve la cuarta parte.
  private moveDrag(dx: number) {
    const drag = this.drag;
    if (!drag || drag.released) return;

    const neighborTab = tabs[this.currentIndex + (dx < 0 ? 1 : -1)];
    if (neighborTab !== drag.neighborTab) {
      this.hideNeighbor(drag);
      drag.neighborTab = neighborTab;
      drag.neighbor = neighborTab ? this.showNeighbor(neighborTab) : undefined;
    }
    const x = drag.neighbor ? dx : dx / 4;
    this.translate(drag.current, x);
    if (drag.neighbor) this.translate(drag.neighbor, x + (dx < 0 ? drag.width : -drag.width));
  }

  // Pasa a la vecina si se arrastró más de un tercio o se soltó con impulso hacia ella; si no, vuelve a su sitio.
  private async releaseDrag(dx: number, vx: number) {
    const drag = this.drag;
    if (!drag) return;

    drag.released = true;
    const passes = !!drag.neighbor
      && (Math.abs(dx) > drag.width / 3 || (Math.abs(vx) > 0.2 && Math.sign(vx) === Math.sign(dx)));
    const end = passes ? (dx < 0 ? -drag.width : drag.width) : 0;
    this.translate(drag.current, end, true);
    if (drag.neighbor) this.translate(drag.neighbor, end + (dx < 0 ? drag.width : -drag.width), true);
    await new Promise(resolve => setTimeout(resolve, 300));

    if (passes && drag.neighbor && drag.neighborTab) {
      // Ionic la deja un instante invisible al activarla.
      drag.neighbor.style.opacity = '1';
      // Los estilos se limpian cuando se muestre (onTabShown).
      if (await this.navigate(drag.neighborTab)) return;
    }
    this.hideNeighbor(drag);
    this.clearStyles(drag.current);
    this.drag = undefined;
  }

  // Ionic oculta las pestañas inactivas y detiene su detección de cambios; ionViewWillEnter recarga sus datos.
  private showNeighbor(tab: string): HTMLElement | undefined {
    const view = this.view(tab);
    if (!view) return undefined;
    view.ref.changeDetectorRef.reattach();
    view.element.classList.remove('ion-page-hidden');
    view.element.dispatchEvent(new CustomEvent('ionViewWillEnter'));
    return view.element;
  }

  private hideNeighbor(drag: Drag) {
    if (!drag.neighbor || !drag.neighborTab) return;
    drag.neighbor.classList.add('ion-page-hidden');
    this.clearStyles(drag.neighbor);
    this.view(drag.neighborTab)?.ref.changeDetectorRef.detach();
    drag.neighbor = undefined;
  }

  private translate(element: HTMLElement, x: number, animated = false) {
    element.style.transition = animated ? slideTransition : 'none';
    element.style.transform = `translateX(${x}px)`;
  }

  private clearStyles(element: HTMLElement) {
    element.style.removeProperty('transform');
    element.style.removeProperty('transition');
    element.style.removeProperty('opacity');
  }

  // Durante la precarga o un arrastre del contenido, los toques en la barra no cuentan.
  private goToTab(tab: string) {
    if (this.preload === 'done' && !this.drag) this.navigate(tab);
  }

  // Sin apilar historial (ver NoHistoryLocationStrategy).
  private async navigate(tab: string): Promise<boolean> {
    const url = tabsPrefix + tab;
    return this.router.url !== url && this.router.navigateByUrl(url);
  }
}
