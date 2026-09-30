# Recording an elder interview (for a Pastoral Assistant)

An elder interview is recorded as a **Form Document on the person's profile** —
the interview form, filled in. It is **not** a Shepherding Note, even though
"Elder Interview" is one of the Note Types. A note called "Elder interview" is
the thing the elders asked not to get.

## On the website

1. Open the person: **Shepherd Dashboard → People →** their name.
2. Open the **Documents** tab on their profile.
3. **New Document → Form**, choose the elder interview form, **Create**.
4. The form opens. Fill in the answers from the interview. It saves as you go.
5. Go back to the profile's **Documents** tab and check it is listed there.

Start it from the profile, not from the Library: that is what files it on the
person. It is private to the profile unless someone adds it to the Library.

One interview, one document. If the person already has one for this
interview, open it and finish it rather than starting another.

Name, address, email, phone and birthday gathered at the start of the
interview go on the person's own record, not only in the form: on their
profile, **Edit**, change the details, **Save**.

## Through an AI assistant (the Mosaic MCP connection)

Tell the assistant, in so many words:

> Record this as an elder interview Form Document on their profile, not a note.

What it should do, in order:

1. `shep_find_person` — get the person's id.
2. `shep_list_form_templates` — find the elder interview form's `templateId`.
3. `shep_create_form_document` with that `templateId` **and the `personId`**.
   Leaving out `personId` makes a document that is on nobody's profile.
4. `shep_answer_form_document` — fill in the answers, keyed by question id.
   Anything it could not fill comes back under `skipped` with the reason.

It should call `shep_create_form_document` **once per interview**. Asking it to
"try again" after an error can leave two copies on the profile; check the
Documents tab before retrying, and delete the spare if there is one.

It should **not** use `shep_write_note` for an interview.

## If something looks wrong

- **Made but not on the profile:** check it was started with the person
  (step 3 above). Documents made that way before 30 Sep 2026 were filed in the
  Library only; the profile now picks those up by itself when it is opened.
- **Two copies:** keep the fuller one, delete the other from the Documents tab.
- **Can't find the elder interview form:** ask an editor; it lives in
  **Forms & Registrations** and must be set to *A document*.
