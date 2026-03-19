interface SuggestionMenuOptions<T> {
  menuClassName?: string;
  emptyClassName?: string;
  itemClassName?: string;
  selectedItemClassName?: string;
  emptyText?: string;
  renderItem: (item: T, selected: boolean) => HTMLElement;
}

interface SuggestionMenuProps<T> {
  items: T[];
  clientRect: (() => DOMRect | null) | null;
  command: (item: T) => void;
}

export function createSuggestionMenuRenderer<T>({
  menuClassName = "slash-menu",
  emptyClassName = "slash-menu__empty",
  itemClassName = "slash-menu__item",
  selectedItemClassName = "slash-menu__item--selected",
  emptyText = "No matching items",
  renderItem,
}: SuggestionMenuOptions<T>) {
  let container: HTMLElement | null = null;
  let selectedIndex = 0;
  let currentItems: T[] = [];
  let currentCommand: ((item: T) => void) | null = null;

  const hide = () => {
    container?.remove();
    container = null;
  };

  const position = (clientRect: DOMRect) => {
    if (!container) return;
    container.style.top = `${clientRect.bottom + 4}px`;
    container.style.left = `${clientRect.left}px`;
  };

  const buildList = () => {
    if (!container) return;
    container.innerHTML = "";

    if (currentItems.length === 0) {
      const empty = document.createElement("div");
      empty.className = emptyClassName;
      empty.textContent = emptyText;
      container.appendChild(empty);
      return;
    }

    currentItems.forEach((item, index) => {
      const element = renderItem(item, index === selectedIndex);
      element.classList.add(itemClassName);
      if (index === selectedIndex) {
        element.classList.add(selectedItemClassName);
      }
      element.addEventListener("mousedown", (e) => {
        e.preventDefault();
        currentCommand?.(item);
      });
      container!.appendChild(element);
    });
  };

  const show = ({ items, clientRect, command }: SuggestionMenuProps<T>) => {
    currentItems = items;
    currentCommand = command;
    selectedIndex = 0;

    if (!container) {
      container = document.createElement("div");
      container.className = menuClassName;
      document.body.appendChild(container);
    }

    const rect = clientRect?.();
    if (rect) position(rect);
    buildList();
  };

  return {
    onStart: (props: SuggestionMenuProps<T>) => {
      show(props);
    },
    onUpdate: (props: SuggestionMenuProps<T>) => {
      show(props);
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        selectedIndex = (selectedIndex + 1) % Math.max(currentItems.length, 1);
        buildList();
        return true;
      }
      if (event.key === "ArrowUp") {
        selectedIndex = (selectedIndex - 1 + currentItems.length) % Math.max(currentItems.length, 1);
        buildList();
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const selected = currentItems[selectedIndex];
        if (selected) {
          currentCommand?.(selected);
          return true;
        }
      }
      if (event.key === "Escape") {
        hide();
        return true;
      }
      return false;
    },
    onExit: hide,
  };
}
