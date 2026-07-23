import { Settings } from "lucide-react";

import { Button } from "t-components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "t-components/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "t-components/tabs";
import { GeneralSettingsPage } from "@/components/settings/general-settings-page";
import { ToolsSettingsPage } from "@/components/settings/tools-settings-page";

export function SettingsDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="icon-xs" variant="outline" aria-label="Open settings">
          <Settings className="size-4" />
          <span className="sr-only">Open settings</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="grid h-[75vh] max-h-[90vh] w-[calc(100%-2rem)] max-w-4xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Manage OpenCAM preferences and backend library records.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="tools" className="min-h-0 overflow-hidden">
          <TabsList className="w-fit">
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="tools" className="min-h-0 overflow-y-auto pr-1">
            <ToolsSettingsPage />
          </TabsContent>
          <TabsContent value="settings" className="min-h-0 overflow-y-auto pr-1">
            <GeneralSettingsPage />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
