-- =============================================================================
-- Gimnasio: la Agenda manda la asistencia (pedido del dueño, 5-nov-2026). Va después de 150.
--
--   Cambiar el estado de una cita en la Agenda mueve la asistencia de sus alumnos, con las mismas
--   reglas que la Recepción (gim_asistencia_estado: deuda vencida, membresía, clase suelta):
--     pendiente → pendiente · confirmada → confirmada · en_espera → en espera · completada → culminada
--     no_asistio → no asistió · cancelada → cancelada · reprogramada → reagendada, y el alumno queda
--     anotado (pendiente) en la cita nueva.
--   Clase grupal cancelada en la Agenda: se cancelan los alumnos que no llegaron a cerrar.
--   Clase grupal en otro estado: no toca a los alumnos (cada uno se marca en la Recepción).
--   Con la función Gimnasio apagada no hace nada. Las asistencias ya cerradas no se tocan.
--
-- IDEMPOTENTE.
-- =============================================================================

begin;
set local search_path to :"schema", public;

create or replace function gim_cita_sigue() returns trigger
language plpgsql security definer set search_path = :"schema", public as $fn$
declare
  v_estado text;
  a record;
  v_nueva uuid;
begin
  if new.estado is not distinct from old.estado then return new; end if;
  if not funcion_activa(new.empresa_id, 'gimnasio') then return new; end if;
  if not exists (select 1 from gim_asistencias where cita_id = new.id) then return new; end if;

  -- Clase grupal: solo la cancelación arrastra a los alumnos.
  if new.gim_clase_id is not null then
    if new.estado = 'cancelada' then
      update gim_asistencias set estado = 'cancelada', updated_at = now()
       where cita_id = new.id and estado in ('pendiente', 'confirmada', 'en_espera');
    end if;
    return new;
  end if;

  v_estado := case new.estado when 'completada' then 'culminada' when 'reprogramada' then 'reagendada' else new.estado end;
  for a in select id, cliente_id, estado from gim_asistencias
            where cita_id = new.id and estado in ('pendiente', 'confirmada', 'en_espera') loop
    if a.estado <> v_estado then
      perform gim_asistencia_estado(a.id, v_estado);
    end if;
    -- Reprogramada: el alumno pasa a la cita nueva.
    if new.estado = 'reprogramada' then
      select id into v_nueva from agenda_citas where reprogramada_de_id = new.id order by created_at desc limit 1;
      if v_nueva is not null then
        insert into gim_asistencias (empresa_id, cita_id, cliente_id, fecha, estado, profesor_id, created_by)
        select new.empresa_id, c.id, a.cliente_id, (c.inicio_at at time zone 'America/Asuncion')::date, 'pendiente', c.responsable_id,
               (select id from usuarios where auth_user_id = auth.uid() and empresa_id = new.empresa_id limit 1)
          from agenda_citas c where c.id = v_nueva
        on conflict (cita_id, cliente_id) where cita_id is not null do nothing;
      end if;
    end if;
  end loop;
  return new;
end;
$fn$;
revoke all on function gim_cita_sigue() from public, anon, authenticated;

drop trigger if exists agenda_citas_gim_sigue on agenda_citas;
create trigger agenda_citas_gim_sigue after update of estado on agenda_citas
  for each row execute function gim_cita_sigue();

commit;
