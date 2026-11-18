-- =============================================================================
-- Etapas del pipeline del CRM por empresa, también para las empresas NUEVAS.
--
-- La receta 34 las cargaba "para cada empresa que exista". En un clon las recetas corren
-- ANTES de que seed-admin cree la empresa, así que todo cliente nuevo quedaba sin etapas:
-- el Kanban vacío y "Configurar etapas" daba "Too small: expected array to have >=1 items".
--
-- Igual que la 161 (Soporte): una función que carga las etapas de UNA empresa, un trigger
-- al crear la empresa y un relleno de las que ya existen. IDEMPOTENTE: no pisa lo que una
-- empresa ya tenga o haya editado.
-- =============================================================================

begin;
set local search_path to :"schema", public;

create or replace function :"schema".crm_etapas_iniciales(p_empresa uuid)
returns void language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  insert into crm_etapas (empresa_id, codigo, nombre, color, orden, es_ganado, es_perdido)
  select p_empresa, x.* from (values
    ('LEAD', 'Lead', 'gray', 1, false, false),
    ('CONTACTADO', 'Contactado', 'blue', 2, false, false),
    ('NEGOCIACION', 'Negociación', 'amber', 3, false, false),
    ('GANADO', 'Ganado', 'green', 4, true, false),
    ('PERDIDO', 'Perdido', 'red', 5, false, true)
  ) as x(codigo, nombre, color, orden, es_ganado, es_perdido)
  on conflict (empresa_id, codigo) do nothing;
end;
$fn$;

-- Empresas nuevas.
create or replace function :"schema".tg_empresas_crm_etapas()
returns trigger language plpgsql security definer set search_path = :"schema", public as $fn$
begin
  perform crm_etapas_iniciales(new.id);
  return null;
end;
$fn$;
drop trigger if exists trg_empresas_crm_etapas on :"schema".empresas;
create trigger trg_empresas_crm_etapas after insert on :"schema".empresas
  for each row execute function :"schema".tg_empresas_crm_etapas();

-- Empresas que ya existen (las clonadas antes de esta receta quedaron sin etapas).
do $mig$
declare e record;
begin
  for e in select id from empresas loop
    perform crm_etapas_iniciales(e.id);
  end loop;
end
$mig$;

revoke execute on function :"schema".crm_etapas_iniciales(uuid) from public, anon, authenticated;
revoke execute on function :"schema".tg_empresas_crm_etapas() from public, anon, authenticated;

commit;
