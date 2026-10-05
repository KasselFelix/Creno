import { CalendarController } from '@fullcalendar/react';
import { EventCalendarNextIcon, EventCalendarPrevIcon } from '@/components/event-calendar-icons';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export interface EventCalendarToolbarProps {
  className?: string;
  controller: CalendarController;
  availableViews: string[];
  addButton?: {
    isPrimary?: boolean;
    text?: string;
    hint?: string;
    click?: (ev: MouseEvent) => void;
  };
}

export function EventCalendarToolbar({
  className,
  controller,
  availableViews,
  addButton,
}: EventCalendarToolbarProps) {
  const buttons = controller.getButtonState();

  return (
    <div className={cn('flex items-center justify-between flex-wrap gap-3', className)}>
      {/* Adapté du registre : le groupe passe à la ligne au lieu de déborder sur mobile. */}
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        {addButton && (
          <Button
            onClick={(event) => addButton.click?.(event.nativeEvent)}
            aria-label={addButton.hint}
          >
            {addButton.text}
          </Button>
        )}
        <Button
          onClick={() => controller.today()}
          aria-label={buttons.today.hint}
          variant="outline"
          className="h-11"
        >
          {buttons.today.text}
        </Button>
        <div className="flex items-center">
          <Button
            onClick={() => controller.prev()}
            disabled={buttons.prev.isDisabled}
            aria-label={buttons.prev.hint}
            variant="ghost"
            size="icon"
            className="size-11"
          >
            <EventCalendarPrevIcon />
          </Button>
          <Button
            onClick={() => controller.next()}
            disabled={buttons.next.isDisabled}
            aria-label={buttons.next.hint}
            variant="ghost"
            size="icon"
            className="size-11"
          >
            <EventCalendarNextIcon />
          </Button>
        </div>
        <div className="text-lg sm:text-xl">{controller.view?.title}</div>
      </div>
      <Tabs value={controller.view?.type ?? availableViews[0]}>
        {/* Adapté du registre : onglets de 45 px de haut (cible tactile), comme ailleurs dans l'app. */}
        <TabsList className="h-13!">
          {availableViews.map((availableView) => (
            <TabsTrigger
              key={availableView}
              value={availableView}
              onClick={() => controller.changeView(availableView)}
              aria-label={buttons[availableView]?.hint}
            >
              {buttons[availableView]?.text}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
