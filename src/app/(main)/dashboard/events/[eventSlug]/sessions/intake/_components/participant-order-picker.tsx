"use client";

import { useState } from "react";

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FieldDescription, FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface ParticipantOrderPickerProps {
  readonly speakers: readonly { readonly id: string; readonly name: string; readonly email: string }[];
}

export function ParticipantOrderPicker({ speakers }: ParticipantOrderPickerProps) {
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [candidateId, setCandidateId] = useState("");
  const selected = selectedIds.flatMap((id) => {
    const speaker = speakers.find((candidate) => candidate.id === id);
    return speaker ? [speaker] : [];
  });
  const available = speakers.filter(({ id }) => !selectedIds.includes(id));

  const add = () => {
    if (candidateId === "" || selectedIds.includes(candidateId)) return;
    setSelectedIds((current) => [...current, candidateId]);
    setCandidateId("");
  };

  const move = (index: number, offset: -1 | 1) => {
    setSelectedIds((current) => {
      const next = [...current];
      const target = index + offset;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  return (
    <FieldSet>
      <FieldLegend variant="label">Participants</FieldLegend>
      <FieldDescription>Add existing event speakers, then arrange them in display order.</FieldDescription>
      {selectedIds.map((id) => (
        <input key={id} name="speakerIds" type="hidden" value={id} />
      ))}
      <FieldGroup className="gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto]">
        <Select onValueChange={setCandidateId} value={candidateId}>
          <SelectTrigger aria-label="Participant to add">
            <SelectValue placeholder={available.length === 0 ? "No more speakers available" : "Choose a speaker"} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {available.map((speaker) => (
                <SelectItem key={speaker.id} value={speaker.id}>
                  {speaker.name} · {speaker.email}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button disabled={candidateId === ""} onClick={add} type="button" variant="outline">
          <Plus data-icon="inline-start" />
          Add participant
        </Button>
      </FieldGroup>
      {selected.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Speaker</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {selected.map((speaker, index) => (
              <TableRow key={speaker.id}>
                <TableCell>{index + 1}</TableCell>
                <TableCell>
                  <span className="font-medium">{speaker.name}</span>
                  <span className="block text-muted-foreground text-xs">{speaker.email}</span>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      aria-label={`Move ${speaker.name} up`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      aria-label={`Move ${speaker.name} down`}
                      disabled={index === selected.length - 1}
                      onClick={() => move(index, 1)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      aria-label={`Remove ${speaker.name}`}
                      onClick={() => setSelectedIds((current) => current.filter((id) => id !== speaker.id))}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <X />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground text-sm">No participants selected.</p>
      )}
    </FieldSet>
  );
}
