import { type CalendarOptions, useCalendarController } from '@fullcalendar/react';
import interactionPlugin from '@fullcalendar/react/interaction';
import timeGridPlugin from '@fullcalendar/react/timegrid';
import { EventCalendarViews } from '@/components/ui/event-calendar-views';
import { EventCalendarToolbar } from '@/components/event-calendar-toolbar';
import { EventCalendarCloseIcon } from '@/components/event-calendar-icons';
import { cn } from '@/lib/utils';

// Adapté du registre FullCalendar (`@fullcalendar/classic-event-calendar`) : seules les vues
// semaine/jour et l'interaction (glisser-déposer, sélection) sont chargées.
const plugins = [timeGridPlugin, interactionPlugin];
const defaultAvailableViews = ['timeGridWeek', 'timeGridDay'];
const navLinkDayClick = 'timeGridDay';
const navLinkWeekClick = 'timeGridWeek';

export interface EventCalendarProps extends Omit<
  CalendarOptions,
  'class' | 'className' | 'headerToolbar' | 'footerToolbar'
> {
  className?: string;
  availableViews?: string[];
  addButton?: {
    isPrimary?: boolean;
    text?: string;
    hint?: string;
    click?: (ev: MouseEvent) => void;
  };
}

export function EventCalendar({
  availableViews = defaultAvailableViews,
  addButton,
  className,
  height,
  contentHeight,
  direction,
  plugins: userPlugins = [],
  ...restOptions
}: EventCalendarProps) {
  const controller = useCalendarController();

  const hasBorderX = !(restOptions.borderlessX ?? restOptions.borderless);
  const hasBorderBottom = !(restOptions.borderlessBottom ?? restOptions.borderless);
  const isHeightAuto = height === 'auto' || contentHeight === 'auto';

  return (
    <div
      className={cn(className, 'flex flex-col gap-5')}
      style={{ height }}
      dir={direction === 'rtl' ? 'rtl' : undefined}
    >
      <EventCalendarToolbar
        className={!hasBorderX ? 'px-3' : undefined}
        controller={controller}
        availableViews={availableViews}
        addButton={addButton}
      />
      <div className="grow min-h-0">
        <EventCalendarViews
          className={cn(
            'bg-background border-t',
            hasBorderX && 'border-x',
            hasBorderBottom && 'border-b',
            hasBorderX && !isHeightAuto && 'rounded-t-xs',
            hasBorderBottom && hasBorderX && !isHeightAuto && 'rounded-b-xs',
            !isHeightAuto && 'overflow-hidden',
          )}
          height={isHeightAuto ? 'auto' : height !== undefined ? '100%' : contentHeight}
          initialView={availableViews[0]}
          navLinkDayClick={navLinkDayClick}
          navLinkWeekClick={navLinkWeekClick}
          controller={controller}
          plugins={[...plugins, ...userPlugins]}
          popoverCloseContent={() => <EventCalendarCloseIcon />}
          {...restOptions}
        />
      </div>
    </div>
  );
}
