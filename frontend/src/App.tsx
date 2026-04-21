import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemHeader,
  ItemFooter,
} from "@/components/ui/item";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModeToggle } from "@/components/mode-toggle";
import { ClickButton } from "@/components/click-button";

function App() {
  return (
    <div className="flex items-center justify-center min-h-svh">
      <Item variant="outline" className="flex-col items-start">
        <ItemHeader>
          <ItemContent>
            <ItemTitle>This is a Title</ItemTitle>
            <ItemDescription>This is a Description</ItemDescription>
          </ItemContent>
        </ItemHeader>
        <div className="w-full">
          <form>
            <div className="grid w-full items-center gap-4">
              <div className="flex flex-col space-y-1.5">
                <Label htmlFor="input">Input</Label>
                <Input id="input" placeholder="Type something..." />
              </div>
            </div>
          </form>
        </div>
        <ItemFooter className="flex-wrap">
          <ModeToggle />
          <ClickButton />
        </ItemFooter>
      </Item>
    </div>
  );
}

export default App;
