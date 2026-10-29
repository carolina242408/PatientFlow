import type { ComponentProps } from "react"
import { ChevronDownIcon } from "lucide-react"
import { cn } from "@/lib/utils"

function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <div data-slot="select-wrapper" className="relative w-full">
      <select
        data-slot="select"
        className={cn(
          "h-10 w-full appearance-none rounded-md border border-gray-200 bg-white pr-9 pl-3 text-sm text-gray-900",
          "focus-visible:border-[#2563EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/20",
          "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-red-500 aria-invalid:ring-red-500/20",
          className,
        )}
        {...props}
      />
      <ChevronDownIcon
        data-slot="select-icon"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-gray-500"
      />
    </div>
  )
}

function SelectOption(props: ComponentProps<"option">) {
  return <option data-slot="select-option" {...props} />
}

export { Select, SelectOption }
