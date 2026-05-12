import { cva } from "class-variance-authority";

export const buttonVariants = cva(
	"inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent text-sm font-medium transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default:
					"bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/85",
				secondary:
					"bg-secondary text-secondary-foreground hover:bg-secondary/80",
				outline:
					"border-border bg-background hover:bg-muted hover:text-foreground",
				ghost: "hover:bg-muted hover:text-foreground",
				destructive:
					"bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/30",
				link: "text-primary underline-offset-4 hover:underline",
			},
			size: {
				default: "h-9 px-3",
				sm: "h-8 px-2.5 text-xs",
				lg: "h-10 px-4",
				icon: "size-9",
				"icon-sm": "size-8",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);
