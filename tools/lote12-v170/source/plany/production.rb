# encoding: UTF-8
require 'csv'
require 'cgi'
require_relative 'ui_feedback'
module RQMyDina
  module Production
    PARTIAL_WARNING = 'PLANO PARCIAL — PEÇAS PENDENTES'.freeze
    def self.issue(path, owner, error, kind = 'part', cached_name = nil)
      clean = ->(value) { PlanyUiFeedback.diagnostic(value.to_s).gsub(/[\r\n\t]/, ' ')[0,240] }
      names = path.map { |item| clean.call(item.name.to_s.empty? ? 'Grupo sem nome' : item.name) }
      module_name = owner ? clean.call(cached_name || Geometry.read(owner.last)['name']) : 'Peças avulsas'
      {'occurrence_id'=>Graph.key(path), 'name'=>names.last, 'module'=>module_name, 'hierarchy'=>names,
       'kind'=>kind, 'reason'=>'Não passou na verificação para corte.', 'detail'=>clean.call(error.message), 'state'=>'pending'}
    end
    def self.partial_snapshot(data, token)
      details = Array(data['issue_details'])
      raise ArgumentError, 'Atualize a coleta para identificar as pendências deste plano.' if details.empty? || details.any? { |item| item['occurrence_id'].to_s.empty? }
      raise ArgumentError, 'Uma configuração de módulo precisa ser revista antes de preparar um plano parcial seguro.' if details.any? { |item| item['kind'] != 'part' }
      raise ArgumentError, 'Não há peças válidas para um plano parcial.' if data['rows'].empty?
      {'schema_version'=>1,'approved'=>true,'collection_id'=>token,'warning'=>PARTIAL_WARNING,
       'included_piece_count'=>data['rows'].length,'included_ids'=>data['rows'].map { |row| row['part_id'] || row['id'] },
       'excluded_count'=>details.length,'excluded_occurrences'=>Marshal.load(Marshal.dump(details))}
    end
    def self.validate_partial!(data)
      return true if Array(data['issues']).empty?
      partial=data['partial'];expected=partial_snapshot(data, partial && partial['collection_id'])
      raise ArgumentError, 'Confirme explicitamente o plano parcial desta coleta antes de continuar.' unless partial.is_a?(Hash) && partial==expected && partial['approved']==true && partial['collection_id'].to_s.match?(/\A[0-9a-f]{32}\z/)
      true
    end
    def self.count_text(n, one, many); "#{n} #{n.to_f == 1 ? one : many}"; end
    def self.collect(model, scope)
      roots = scope == 'all' ? model.entities.to_a : model.selection.to_a
      prefix = scope == 'all' ? [] : (model.active_path || [])
      rows, issues, modules, seen, module_records, recipes, issue_details = [], [], {}, {}, [], {}, []
      actual_panel_feet=[]
      recipe_for = lambda { |entity| recipes[entity] ||= Geometry.read(entity) }
      visit = nil
      visit = lambda do |entity, path, owner|
        next unless Geometry.part?(entity) && entity.valid?
        path = path + [entity]
        next if seen[Graph.key(path)]
        seen[Graph.key(path)] = true
        if (height=entity.get_attribute(Geometry::DICTIONARY,'panel_foot_height'))
          actual_panel_feet << {'height'=>height, 'module_id'=>owner && Graph.key(owner)};next
        end
        if Geometry.module?(entity)
          owner = path
          root_index = path.index { |item| Geometry.module?(item) }
          root_owner = path[0..root_index]
          modules[Graph.key(root_owner)] ||= modules.length + 1
          params=recipe_for.call(entity)
          if params['fronts'].any? { |front| front['kind']=='drawers' && front.fetch('rear_clearance',10)<10 }
            begin
              Parameters.normalize(params,validate_stock:false)
            rescue ArgumentError=>error
              issues << PlanyUiFeedback.diagnostic("#{params['name']}: #{error.message}")
              issue_details << issue(path, owner, error, 'module', params['name'])
            end
          end
          module_records << { 'module_id' => Graph.key(path), 'params' => recipe_for.call(entity),
            'physical_panel_feet'=>entity.get_attribute(Geometry::DICTIONARY,'panel_units_version',0).to_i>=1 }
        elsif Graph.registered?(entity) || (owner && !owner.last.get_attribute(Geometry::DICTIONARY, 'graph_version') && entity.manifold?)
          begin
            root_index = owner && owner.index { |item| Geometry.module?(item) }
            root_owner = root_index && owner[0..root_index]
            modules[Graph.key(root_owner)] ||= modules.length + 1 if root_owner
            # Hand-machined Plany boards are still valid inventory. Their
            # cutting blank is the enclosing rectangle, NOT a CNC contour.
            manual_shape = Graph.registered?(entity) && Geometry.manual_machining?(entity)
            Appearance.box!(entity) unless manual_shape
            tr = Graph.transform(path); Graph.unit(tr)
            sizes = Geometry.physical_size(entity, tr)
            axis = entity.get_attribute(Geometry::DICTIONARY, 'thickness_axis') || sizes.each_index.min_by { |i| sizes[i] }
            data = Geometry.piece_data(entity)
            if data.fetch('construction_type', 'mdf') == 'mdf' && data.fetch('face_materials', {}).slice('face_min', 'face_max').any?
              raise ArgumentError, 'pintura MDF antiga por face pendente; recarregue o Plany para recuperar ou escolha o MDF da chapa inteira antes de enviar à Central'
            end
            thickness = sizes[axis]
            raise ArgumentError, 'espessura fora da faixa de chapas (1 a 100 mm)' unless thickness.between?(1,100)
            uv = sizes.each_with_index.reject { |_,i| i == axis }.map(&:first)
            material = entity.material || (owner && owner.last.material)
            label = data['material'] || (material ? material.display_name : entity.get_attribute(Geometry::DICTIONARY, 'cut_material', 'MDF'))
            label = MaterialCatalog.canonical_name(material || label) if data.fetch('construction_type', 'mdf') == 'mdf' && (data['material'].nil? || data['material'] == material&.display_name)
            label = MaterialCatalog.canonical_name(label) if data.fetch('construction_type', 'mdf') == 'mdf'
            rows << cut_dimensions(uv, data).merge('id' => "P#{rows.length+1}",
              'name' => (entity.name.empty? ? 'Peça avulsa' : entity.name) + (manual_shape ? ' · USINAGEM MANUAL (retângulo de corte)' : ''),
              'manual_machining' => manual_shape,
              'module' => root_owner ? recipe_for.call(root_owner.last)['name'] + ' #' + modules[Graph.key(root_owner)].to_s : 'Peças avulsas',
              'material' => label, 'thickness' => Geometry.clean_mm(thickness),
              'module_id' => owner && Graph.key(owner), 'part_id' => Graph.key(path),
              'unit' => owner && owner.last != root_owner&.last ? recipe_for.call(owner.last)['name'] : nil,
              'role' => entity.get_attribute(Geometry::DICTIONARY, 'role'), 'settings' => data,
              'construction_type' => data.fetch('construction_type', 'mdf'), 'thickness_axis'=>axis)
            rows.last['glass_size'] = uv.map { |v| Geometry.clean_mm(v) } if data['construction_type']=='glass'
            joint_owner=path.each_index.find { |i| Geometry.module?(path[i]) && recipe_for.call(path[i])['joint_banding'] }
            if joint_owner
              row=rows.last
              row['joint_module_id']=Graph.key(path[0..joint_owner])
              row['joint_geometry']=Geometry.joint_banding_panel(path,row['id'],tr)
            end
          rescue ArgumentError => error
            issues << PlanyUiFeedback.diagnostic("#{entity.name}: #{error.message}.")
            issue_details << issue(path, owner, error, 'part', owner && recipe_for.call(owner.last)['name'])
          end
          next
        end
        entity.definition.entities.each { |e| visit.call(e, path, owner) } if path.length < 64
      end
      roots.each { |e| visit.call(e, prefix, prefix.reverse.find { |p| Geometry.module?(p) } && prefix[0..prefix.rindex { |p| Geometry.module?(p) }]) }
      raise ArgumentError, 'Selecione peças ou módulos Plany, ou escolha Todos os módulos do projeto.' if rows.empty? && issues.empty?
      rows.map! { |row| MaterialPolicy.normalize_row(row) }
      rows.group_by { |row| [row['module'], row['name']] }.each_value do |same_name|
        next unless same_name.map { |row| row['module_id'] }.uniq.length > 1
        same_name.each { |row| row['name'] = "#{row['unit']} · #{row['name']}" if row['unit'] }
      end
      issue_details.each_with_index { |item,index| item['code']="D#{index+1}" }
      { 'rows' => rows.select { |row| row['construction_type']=='mdf' }, 'issues' => issues.uniq, 'issue_details'=>issue_details, 'modules' => modules.length,
        'loose_parts' => rows.count { |row| row['module_id'].nil? },
        'materials' => materials(rows, module_records,actual_panel_feet.empty? ? nil : actual_panel_feet) }
    end

    # A material list is a snapshot of the same scope used by the cut list.
    # Hardware is counted only for complete selected modules; selecting an
    # individual board never silently includes the rest of its module.
    def self.materials(rows, module_records, actual_panel_feet=nil)
      slides, hinges, bands, other, mdfs, metals = {}, {}, {}, {}, {}, {}
      requirements, module_materials = [], []
      notes, diagnostics = [], []
      cladding_banding = cladding_banding_runs(rows, module_records, notes)
      cladding_banding.merge!(joint_banding_runs(rows,notes))
      add = lambda do |table, key, fields, quantity|
        item = table[key] ||= fields.merge('quantity' => 0)
        item['quantity'] += quantity
        item
      end
      add_feet = lambda do |height, quantity|
        add.call(other, ['adjustable_foot',height.to_f,Parameters::FOOT_DIAMETER],
          {'kind'=>'accessory','family'=>'feet','name'=>"Sapata regulável · #{Parameters.clean_mm(height)} mm",
           'height'=>height.to_f,'diameter'=>Parameters::FOOT_DIAMETER,'unit'=>'unidades'},quantity)
      end
      requirement = lambda do |name, reason, category, row=nil, module_id=nil|
        requirements << {'name'=>name,'reason'=>reason,'category'=>category,
          'source_ids'=>row ? [row['part_id'] || row['id']].compact : [],
          'module_ids'=>[module_id || row && row['module_id']].compact}
      end
      rows.each do |row|
        settings = row['settings'].is_a?(Hash) ? row['settings'] : {}
        material = row['material'].to_s
        thickness = row['thickness'].to_f
        length = row.fetch('finished_length', row['length']).to_f
        width = row.fetch('finished_width', row['width']).to_f
        family = row['construction_type'] || settings['construction_type'] || 'mdf'
        if family == 'glass'
          glass = Glass.normalize(settings)
          # Keep U/V dimensions: finishes refer to these physical edges, not a rotated cut sheet.
          length, width = row.fetch('glass_size', [length, width])
          key = [row['name'], material, thickness, length, width, glass]
          add.call(other, ['glass', *key], {'kind'=>'glass', 'name'=>row['name'],
            'material'=>material, 'thickness'=>thickness, 'length'=>length, 'width'=>width}.merge(glass), 1)
        elsif family == 'metal'
          item = add.call(metals,[row['name'],material,thickness,length,width],
            {'name'=>row['name'],'material'=>material,'thickness'=>thickness,'length'=>length,'width'=>width,'area_m2'=>0.0},1)
          item['area_m2'] += length * width / 1_000_000.0
        elsif family == 'mdf'
          key = [material, thickness]
          item = add.call(mdfs, key, {'material'=>material, 'thickness'=>thickness,
            'area_m2'=>0.0}.merge(MaterialPolicy.flexible?(row) ? {'material_policy'=>'any_mdf','purchase'=>false} : {}), 1)
          item['area_m2'] += length * width / 1_000_000.0
          length_axis = row['length_axis'] == 'v' ? 'v' : 'u'
          band_thickness = row['tape_thickness'] || settings['tape_thickness']
          Array(row['edges']).uniq.each do |edge|
            next unless %w[u_min u_max v_min v_max].include?(edge)
            next if Array(row['band_managed_edges']).include?(edge) || edge == cladding_front_edge(row['role']) && cladding_banding.key?(row['id'])
            band_material = row.fetch('edge_materials', {})[edge] || material
            if MaterialPolicy.retalho?(band_material)
              diagnostics << {'code'=>'band_color_missing', 'source_id'=>row['part_id'] || row['id'], 'message'=>"Confira a cor da fita de #{row['name'] || row['id']}; ela não está definida."}
              next
            end
            edge_length = edge.start_with?(length_axis) ? width : length
            begin
              band_width = band_width_for(thickness)
            rescue ArgumentError => error
              diagnostics << {'code'=>'band_width_missing', 'source_id'=>row['part_id'] || row['id'], 'message'=>error.message}
              next
            end
            band = add.call(bands, [band_material, band_width, band_thickness], {'material'=>band_material,
              'width'=>band_width, 'thickness'=>band_thickness, 'length_mm'=>0.0}, 1)
            band['length_mm'] += edge_length
          end
          Array(cladding_banding[row['id']]).each do |run|
            next if MaterialPolicy.retalho?(run['material'])
            band = add.call(bands, [run['material'], run['width'], band_thickness],
              {'material'=>run['material'], 'width'=>run['width'], 'thickness'=>band_thickness, 'length_mm'=>0.0}, 1)
            band['length_mm'] += run['length']
          end
        else
          requirement.call(row['name'] || 'Peça','Família física não reconhecida no levantamento.','accessories',row)
        end
        if row['role'].to_s.start_with?('split:')
          fixation = settings['fixation']
          name = {'dowel'=>'Cavilhas','connector'=>'Conectores','shelf_support'=>'Suportes de prateleira',
            'angle'=>'Cantoneiras','screw'=>'Parafusos'}[fixation]
          if name
            requirement.call(name,'A fixação está configurada, mas a receita não define quantidade nem especificação da ferragem por peça.','accessories',row)
          end
        end
        if settings['led']
          requirement.call('Iluminação LED','A receita define somente canal e posição; fita LED, perfil e fonte não estão especificados.','accessories',row)
        end
      end
      module_records.each do |record|
        params = record['params'] || record
        before = [slides,hinges,other].map { |table| table.transform_values { |item| item['quantity'] } }
        source_materials = nil
        begin
          feet = Parameters.baseboard_foot_positions(params)
          unless feet.empty?
            add_feet.call(feet.first[3],feet.length)
          end
          if params['module_family']=='panel' && !record['physical_panel_feet']
            panel_feet=Panel.foot_positions(params)
            unless panel_feet.empty?
              add_feet.call(panel_feet.first[3],panel_feet.length)
            end
          end
          actual = Array(actual_panel_feet).select { |foot| foot.is_a?(Hash) && foot['module_id'] && foot['module_id']==record['module_id'] }
          actual.group_by { |foot| foot['height'] }.each { |height, values| add_feet.call(height,values.length) }
          layout = Parameters.layout(params)
          panels = layout['panels'].to_h { |panel| [panel['role'], panel] }
          source_rows = rows.select { |row| record['module_id'] && row['module_id']==record['module_id'] }
          physical_roles = source_rows.map { |row| row['role'] }
          available = lambda { |role| panels[role] && (!record['module_id'] || physical_roles.include?(role)) }
          source_for = lambda { |role| row=source_rows.find { |candidate| candidate['role']==role }; row && (row['part_id'] || row['id']) }
          source_materials = []
          door_leaves, support_occupancy = [], []
          params.fetch('fronts', []).each do |front|
            region = Parameters.front_region(front, layout['nodes'], layout['openings'])
            supports = [['left', region['x'] - region['edges'][0] / 2.0],
              ['right', region['x'] + region['width'] + region['edges'][1] / 2.0]]
            front['count'].times do |index|
              face_role = front['kind'] == 'drawers' ? "front:#{front['id']}:#{index}:face" : "front:#{front['id']}:#{index}"
              face = available.call(face_role) && panels[face_role]
              next unless face && front['fit'] == 'overlay'
              occupied_sides = front['kind'] == 'door' && front['count'] > 1 ?
                (index == 0 ? ['left'] : index == front['count'] - 1 ? ['right'] : []) : %w[left right]
              supports.each do |side, support_x|
                next unless occupied_sides.include?(side)
                support_occupancy << {'front_id'=>front['id'], 'side'=>side,
                  'support_x'=>support_x, 'face'=>front['side'],
                  'bottom'=>face['origin'][2], 'top'=>face['origin'][2] + face['size'][2]}
              end
            end
            if front['kind'] == 'drawers'
              next if front['loose_drawer'] && !front['include_runners']
              front['count'].times do |index|
                bottom = panels["front:#{front['id']}:#{index}:bottom"]
                next unless bottom && available.call(bottom['role'])
                depth = front['drawer_type']=='spice' || front['loose_drawer'] ? front['box_depth'] : bottom['size'][1].to_f
                pairs = front['drawer_type']=='spice' && front['spice_runners']=='per_level' ? front['spice_levels'] : 1
                runner = front['runner']
                nominal = runner == 'telescopic' ? [(depth / 50).floor * 50, 50].max : nil
                slide = add.call(slides, [runner, nominal || depth], {'runner'=>runner,
                  'length'=>nominal, 'box_depth'=>depth, 'box_depths'=>[], 'unit'=>'pares'}, pairs)
                slide['box_depths'] |= [depth]
                source_materials << {'source_id'=>source_for.call(bottom['role']),'slides'=>[slide.merge('quantity'=>pairs)]}
              end
            elsif front['kind'] == 'door' && front['door_type'] == 'hinged'
              front['count'].times do |index|
                leaf = panels["front:#{front['id']}:#{index}"]
                next unless leaf && available.call(leaf['role'])
                left = front['door_opening'] == 'left' || front['door_opening'] == 'double' && index.even?
                side = left ? 'left' : 'right'
                support_x = supports.find { |candidate| candidate[0] == side }[1]
                door_leaves << {'front_id'=>front['id'], 'fit'=>front['fit'], 'side'=>side, 'support_x'=>support_x,'source_id'=>source_for.call(leaf['role']),
                  'face'=>front['side'], 'bottom'=>leaf['origin'][2],
                  'top'=>leaf['origin'][2]+leaf['size'][2],
                  'quantity'=>Hardware.hinge_positions(leaf['size'][2]).length}
              end
            elsif front['kind']=='door' && front['door_type']=='lift'
              front['count'].times do |index|
                leaf=panels["front:#{front['id']}:#{index}"]
                next unless leaf && available.call(leaf['role'])
                spec=Hardware.lift_assessment(front,leaf)
                direction=spec['direction']=='top' ? 'superior' : 'inferior'
                system=spec['kind']=='gas' ? 'Pistão a gás' : 'Articulador mecânico'
                qualified=spec['verified']
                label="#{system} #{direction}"
                detail=spec['force_n'] ? " · pré-seleção #{spec['force_n']} N (NÃO HOMOLOGADA)" : ''
                item=add.call(other,['lift',spec['kind'],spec['direction'],spec['force_n']],{
                  'kind'=>'hardware','family'=>'lift_support','name'=>label+detail,
                  'system'=>spec['kind'],'direction'=>spec['direction'],
                  'force_n'=>spec['force_n'],'required_force_n'=>spec['required_force_n'],
                  'moment_kgf_cm'=>spec['moment_kgf_cm'],'estimated_weight_kg'=>spec['weight_kg'],
                  'reference'=>spec['reference'],'verified'=>qualified,
                  'warning'=>spec['note'],'unit'=>'unidades'},spec['quantity'])
                hinge=add.call(hinges,['basculante',90],{'kind'=>'basculante','angle'=>90,'unit'=>'unidades'},2)
                source_materials << {'source_id'=>source_for.call(leaf['role']),
                  'other_parts'=>[item.merge('quantity'=>spec['quantity'])],
                  'hinges'=>[hinge.merge('quantity'=>2)]}
                if qualified
                  notes << "#{label}: #{spec['note']}" unless notes.include?("#{label}: #{spec['note']}")
                else
                  requirement.call(label,spec['note'],'hardware',nil,record['module_id'])
                end
              end
            elsif front['kind']=='door' && front['door_type']=='sliding'
              if front['sliding_version']==1
                leaves=front['count'].times.map { |index| panels["front:#{front['id']}:#{index}"] }.compact.select { |leaf| available.call(leaf['role']) }
                unless leaves.empty?
                  first=leaves.first['sliding'];length=first['limit_right']-first['limit_left']
                  %w[inferior superior].each do |position|
                    item=add.call(other,['sliding_track',position,front['track_count'],length,front['track_height']],
                      {'kind'=>'hardware','family'=>'sliding_track','name'=>"Trilho #{position} · #{front['track_count']} via(s) · #{length.round(1)} mm",
                       'length'=>length,'tracks'=>front['track_count'],'height'=>front['track_height'],'unit'=>'unidades'},1)
                    source_materials << {'source_id'=>source_for.call(leaves.first['role']),'other_parts'=>[item.merge('quantity'=>1)]}
                  end
                  leaves.each do |leaf|
                    spec=leaf['sliding'];profile=spec['leaf'];next if profile['type']=='mdf'
                    [spec['width'],spec['height']].each do |measure|
                      item=add.call(other,['sliding_profile',measure,profile.values_at('profile_width','profile_depth','profile_wall','engagement','finish')],
                        {'kind'=>'hardware','family'=>'sliding_profile','name'=>"Perfil de alumínio · #{profile['finish']} · #{measure.round(1)} mm",
                         'length'=>measure,'width'=>profile['profile_width'],'depth'=>profile['profile_depth'],'wall'=>profile['profile_wall'],
                         'engagement'=>profile['engagement'],'finish'=>profile['finish'],'unit'=>'unidades'},2)
                      source_materials << {'source_id'=>source_for.call(leaf['role']),'other_parts'=>[item.merge('quantity'=>2)]}
                    end
                  end
                  requirement.call('Ferragens da porta de correr','Perfis e trilhos paramétricos definidos; selecionar roldanas e fixações compatíveis com o peso e as dimensões das folhas.','hardware',nil,record['module_id'])
                end
              else
                requirement.call('Sistema de porta de correr',
                'O tipo de porta está definido, mas mecanismo, modelo e quantidade de ferragens não estão especificados.',
                'hardware',nil,record['module_id'])
              end
            end
          end
          door_leaves.each do |leaf|
            shared = support_occupancy.any? do |other_front|
              other_front['front_id'] != leaf['front_id'] &&
                other_front['face'] == leaf['face'] && other_front['side'] != leaf['side'] &&
                (other_front['support_x'] - leaf['support_x']).abs < 0.5 &&
                [other_front['top'], leaf['top']].min - [other_front['bottom'], leaf['bottom']].max > 1
            end
            kind = leaf['fit'] == 'inset' ? 'supercurva' : shared ? 'curva' : 'reta'
            hinge=add.call(hinges, [kind,110], {'kind'=>kind, 'angle'=>110, 'unit'=>'unidades'}, leaf['quantity'])
            source_materials << {'source_id'=>leaf['source_id'],'hinges'=>[hinge.merge('quantity'=>leaf['quantity'])]}
          end
          params.fetch('accessories', []).each do |accessory|
            add.call(other, ['accessory', accessory['family'], accessory['name'].strip.gsub(/\s+/, ' ').downcase],
              {'kind'=>'accessory', 'name'=>accessory['name'], 'family'=>accessory['family'], 'unit'=>'unidades'},
              accessory['quantity'].to_i)
          end
        rescue ArgumentError, KeyError => error
          notes << "Um módulo não pôde ser detalhado: #{error.message}"
        ensure
          if record['module_id']
            snapshot = {'module_id'=>record['module_id'],'source_ids'=>rows.select { |row| row['module_id']==record['module_id'] }.map { |row| row['part_id'] || row['id'] }.compact}
            snapshot['source_materials'] = source_materials if source_materials
            %w[slides hinges other_parts].zip([slides,hinges,other],before).each do |key,table,prior|
              snapshot[key] = table.filter_map do |identity,item|
                delta = item['quantity'] - prior.fetch(identity,0)
                Marshal.load(Marshal.dump(item)).merge('quantity'=>delta) if delta>0
              end
            end
            module_materials << snapshot
          end
        end
      end
      if actual_panel_feet
        unbound = actual_panel_feet.reject { |foot| foot.is_a?(Hash) && module_records.any? { |record| record['module_id'] && record['module_id']==foot['module_id'] } }
        unbound.group_by { |foot| foot.is_a?(Hash) ? foot['height'] : foot }.each do |height,feet|
          add_feet.call(height,feet.length)
        end
      end
      bands.each_value { |item| item['length_m'] = (item.delete('length_mm') / 1000.0).round(3) }
      mdfs.each_value { |item| item['area_m2'] = item['area_m2'].round(3) }
      metals.each_value { |item| item['area_m2'] = item['area_m2'].round(3) }
      { 'slides'=>slides.values, 'hinges'=>hinges.values, 'edge_banding'=>bands.values,
        'other_parts'=>other.values, 'mdf'=>mdfs.values, 'metals'=>metals.values,
        'glass'=>glass_materials(other.values.select { |item| item['kind']=='glass' }),
        'schema_version'=>2, 'non_cut_rows'=>Marshal.load(Marshal.dump(rows.reject { |row| (row['construction_type'] || row.dig('settings','construction_type') || 'mdf')=='mdf' })),
        'module_materials'=>module_materials, 'undetermined'=>requirements,
        'source_notes'=>notes.uniq, 'diagnostics'=>diagnostics.uniq,
        'notes'=>(notes+diagnostics.map { |item| item['message'] }).uniq }
    end

    def self.glass_materials(parts)
      parts.group_by { |part| part.values_at('glass_model','glass_color','thickness') }.map do |_, cuts|
        first=cuts.first
        {'kind'=>'glass','material'=>Glass.label(first),'glass_model'=>first['glass_model'],
         'glass_color'=>first['glass_color'],'thickness'=>first['thickness'],
         'quantity'=>cuts.sum { |cut| cut['quantity'] },
         'area_m2'=>cuts.sum { |cut| cut['length']*cut['width']*cut['quantity']/1_000_000.0 }.round(3),
         'cuts'=>Marshal.load(Marshal.dump(cuts))}
      end
    end

    BAND_WIDTHS = [22, 35, 45, 64].freeze

    def self.joint_banding_runs(rows,notes)
      result={}
      rows.select { |row| row['joint_geometry'] }.group_by { |row| row['joint_module_id'] }.each_value do |members|
        plan=JointBanding.plan(members.map { |row| row['joint_geometry'].merge('settings'=>row['settings'],'material'=>row['material']) })
        members.each do |row|
          id=row['id'];row['band_managed_edges']=plan[:managed][id]
          result[id]=plan[:runs][id].filter_map do |run|
            begin
              run.merge('width'=>band_width_for(run['physical_width']))
            rescue ArgumentError=>error
              notes << error.message;nil
            end
          end
          row['band_runs']=result[id].map(&:dup)
          shared=plan[:shared][id];next if shared.empty?
          row['manual_edges']=shared
          row['outsourced_edges']-=shared
          row['outsourced_band_segments']=plan[:runs][id].select { |run| shared.include?(run['edge']) && !run['joint'] }.map { |run| {'edge'=>run['edge'],'length'=>run['length']} }
          next unless row['edge_decrement']
          uv=if row['cutting_shape']
            row['cutting_shape'].values_at('finished_u','finished_v')
          else
            row['length_axis']=='v' ? row.values_at('finished_width','finished_length') : row.values_at('finished_length','finished_width')
          end
          dimensions=cut_dimensions(uv,row['settings'].merge('edges'=>row['settings']['edges']-shared))
          row.merge!(dimensions.slice('length','width','cutting_shape'))
        end
      end
      result
    end

    def self.band_width_for(thickness)
      width = BAND_WIDTHS.find { |candidate| candidate >= thickness.to_f + 4 }
      raise ArgumentError, "Fita para espessura de #{thickness} mm não cadastrada; confira a largura necessária." unless width
      width
    end

    def self.cladding_front_edge(role)
      return nil unless role.to_s.start_with?('cladding:') && !role.include?(':rear:')
      %w[left right].include?(role.split(':')[1]) ? 'u_min' : 'v_min'
    end

    # Only recipe-owned, selected boards within the same module can share tape.
    # Segment boundaries retain the correct single-width runs at partial overlaps.
    def self.cladding_banding_runs(rows, module_records, notes)
      runs = {}
      rows.each { |row| row['outsourced_edges'] = Array(row['edges']).dup; row['outsourced_band_segments'] = [] }
      coverage = Hash.new { |hash, key| hash[key] = { 'manual' => 0.0, 'individual' => 0.0 } }
      module_records.each do |record|
        next unless record['module_id']
        next if record['params']['joint_banding']==false
        begin
          panels = Parameters.layout(record['params'])['panels'].to_h { |panel| [panel['role'], panel] }
        rescue ArgumentError, KeyError => error
          notes << "A fitagem de um módulo não pôde ser calculada: #{error.message}"
          next
        end
        members = rows.filter_map do |row|
          next unless row['module_id'] == record['module_id']
          next if row['joint_geometry']
          edge = cladding_front_edge(row['role'])
          next unless edge && Array(row['edges']).include?(edge)
          panel = panels[row['role']]
          next unless panel
          next if row.fetch('settings', {})['edge_override']
          runs[row['id']] = []
          side = row['role'].split(':')[1]
          long_axis = %w[left right].include?(side) ? 2 : 0
          thickness_axis = panel['thickness_axis']
          { 'row'=>row, 'panel'=>panel, 'side'=>side, 'long_axis'=>long_axis,
            'thickness_axis'=>thickness_axis, 'start'=>panel['origin'][long_axis],
            'end'=>panel['origin'][long_axis]+panel['size'][long_axis],
            'thickness_start'=>panel['origin'][thickness_axis],
            'thickness_end'=>panel['origin'][thickness_axis]+panel['size'][thickness_axis],
            'front'=>panel['origin'][1], 'material'=>row.fetch('edge_materials', {})[edge] || row['material'] }
        end.compact
        members.group_by { |m| [m['side'], m['front'].round(3), m['material']] }.each_value do |group|
          boundaries = group.flat_map { |m| [m['start'], m['end']] }.uniq.sort
          boundaries.each_cons(2) do |lo, hi|
            active = group.select { |m| m['start'] <= lo+0.001 && m['end'] >= hi-0.001 }
            next if active.empty?
            stacks = active.sort_by { |m| m['thickness_start'] }.chunk_while do |a, b|
              (a['thickness_end'] - b['thickness_start']).abs < 0.001
            end
            stacks.each do |stack|
              physical = stack.sum { |m| m['thickness_end'] - m['thickness_start'] }
              stack.each do |member|
                coverage[member['row']['id']][stack.length > 1 ? 'manual' : 'individual'] += hi-lo
              end
              begin
                width = band_width_for(physical)
              rescue ArgumentError => error
                notes << error.message
                next
              end
              if width > 22
                notes << "Confirme a disponibilidade da fita de #{width} mm em #{stack.first['material']}."
              end
              primary = stack.first
              runs[primary['row']['id']] << { 'material'=>primary['material'], 'width'=>width, 'length'=>hi-lo }
            end
          end
        end
      end
      rows.each do |row|
        row['band_runs'] = Array(runs[row['id']]).map(&:dup) if runs.key?(row['id'])
        lengths = coverage[row['id']]
        next unless lengths['manual'] > 0.001
        edge = cladding_front_edge(row['role'])
        next unless edge
        row['manual_edges'] = [edge]
        row['outsourced_edges'].delete(edge)
        row['outsourced_band_segments'] << lengths['individual'] if lengths['individual'] > 0.001
        next unless row['edge_decrement']
        dimension = edge.start_with?(row['length_axis']) ? 'length' : 'width'
        if row['cutting_shape']
          shape = row['cutting_shape']
          uv = shape.values_at('finished_u','finished_v')
          adjusted = row['settings'].merge('edges'=>row['settings']['edges']-[edge])
          dimensions = cut_dimensions(uv, adjusted)
          row.merge!(dimensions.slice('length','width','cutting_shape'))
        else
          row[dimension] = Parameters.clean_mm(row[dimension] + row['tape_thickness'])
        end
      end
      runs
    end

    def self.cut_dimensions(uv, data)
      raise ArgumentError, 'Este material ainda não possui sentido de veio validado no catálogo.' if data['grain'] == 'unknown'
      data = Parameters.normalize_piece(data)
      cut = uv.dup
      if data['edge_decrement']
        %w[u v].each_with_index do |axis, i|
          cut[i] -= data['edges'].count { |edge| edge.start_with?(axis + '_') } * data['tape_thickness']
        end
      end
      raise ArgumentError, 'a fita consome a dimensão da peça' if cut.any? { |v| v < 1 }
      orientation = PieceOrientation.initial(uv, data['cut_orientation'])
      u_first = orientation == 'u_length'
      length_axis = u_first ? 'u' : 'v'
      grain = data['grain'] == 'free' ? 'free' : (data['grain'] == length_axis ? 'length' : 'width')
      result = { 'length' => Parameters.clean_mm(cut[u_first ? 0 : 1]), 'width' => Parameters.clean_mm(cut[u_first ? 1 : 0]),
        'finished_length' => Parameters.clean_mm(uv[u_first ? 0 : 1]), 'finished_width' => Parameters.clean_mm(uv[u_first ? 1 : 0]),
        'cut_orientation' => orientation,
        'length_axis' => length_axis, 'grain' => grain, 'edges' => data['edges'], 'edge_materials' => data.fetch('edge_materials', {}),
        'tape_thickness' => data['tape_thickness'], 'edge_decrement' => data['edge_decrement'] }
      if data.key?('grain_angle') && data['grain'] != 'free'
        blank = PieceOrientation.grain_blank(cut, data['grain_angle'])
        # Full precision is required for reservation; finished/export measures keep their convention.
        result.merge!('length'=>blank['length'], 'width'=>blank['width'], 'grain'=>'length',
          'grain_angle'=>data['grain_angle'], 'cutting_shape'=>blank.merge('finished_u'=>uv[0], 'finished_v'=>uv[1]))
      end
      result
    end

    def self.apply_overrides(rows, overrides)
      raise ArgumentError, 'Configurações de peças inválidas.' unless overrides.is_a?(Hash)
      rows.map do |row|
        change = overrides[row['id']] || {}
        raise ArgumentError, 'Configuração de peça inválida.' unless change.is_a?(Hash)
        material = change.fetch('material',row['material']).to_s.strip
        raise ArgumentError, "Informe um nome de material de até #{Parameters::MATERIAL_NAME_LIMIT} caracteres." if material.empty? || material.length > Parameters::MATERIAL_NAME_LIMIT
        if row.fetch('construction_type', 'mdf') == 'mdf'
          if MaterialPolicy.retalho?(material)
            next MaterialPolicy.normalize_row(row.merge('material'=>material))
          end
          entry = MaterialCatalog.mdf_entry_by_name(material)
          raise ArgumentError, "Material MDF não reconhecido no catálogo: #{material}." unless entry && entry.fetch('family', 'mdf') == 'mdf'
          material = MaterialCatalog.model_material_name(entry)
          axis = MaterialCatalog.grain_for_material(material)
          raise ArgumentError, 'Este material ainda não possui sentido de veio validado no catálogo.' if axis == 'unknown'
          grain = axis == 'free' ? 'free' : (axis == row['length_axis'] ? 'length' : 'width')
          if row['settings'].is_a?(Hash) && row['settings'].key?('grain_angle')
            uv = row['length_axis']=='v' ? row.values_at('finished_width','finished_length') : row.values_at('finished_length','finished_width')
            shape = row['cutting_shape']
            uv = shape.values_at('finished_u','finished_v') if shape
            dimensions = cut_dimensions(uv, row['settings'].merge('grain'=>axis, 'material'=>material))
            next MaterialPolicy.normalize_row(row.reject { |key,_| %w[cutting_shape grain_angle].include?(key) }.merge(dimensions).merge('material'=>material))
          end
          MaterialPolicy.normalize_row(row.merge('grain' => grain, 'material' => material))
        else
          row.merge('material' => material)
        end
      end
    end

    def self.persist_overrides(model, rows, overrides)
      changed = Cutting.normalize_rows(apply_overrides(rows, overrides))
      # Resolve every original path before making any shared ancestor unique.
      paths = changed.map { |row| Graph.resolve(model, row['part_id']) }
      Workshop.batch(model) do
        paths = Graph.unique_paths(paths)
        changed.each_with_index do |row,i|
          path = paths[i]; part = path.last
          data = row['settings'].merge('material' => row['material'], 'grain' =>
            row['grain'] == 'free' ? 'free' : row['grain'] == 'length' ? row['length_axis'] : (row['length_axis'] == 'u' ? 'v' : 'u'))
          data['grain'] = MaterialCatalog.grain_for_material(row['material']) if data.key?('grain_angle') && !MaterialPolicy.retalho?(row['material'])
          Finishing.persist_piece_material(path, data, row['material'])
          owner = path.reverse.find { |e| Geometry.module?(e) }
          if owner && row['role']
            params = Geometry.read(owner)
            params['piece_settings'][row['role']] = data
            Geometry.store(owner, params)
          end
        end
      end
    end

    def self.csv_cell(text)
      value = text.to_s
      value = "'" + value if value.lstrip.match?(/\A[=+@\-\t\r]/)
      value
    end

    def self.csv_measure(value)
      value.to_s.tr('.', ',')
    end

    def self.edge_banding_measures(row)
      axis = %w[u v].include?(row['length_axis']) ? row['length_axis'] : (row['cut_orientation'] == 'v_length' ? 'v' : 'u')
      edges = row['outsourced_edges'].is_a?(Array) ? row['outsourced_edges'] : (row['edges'].is_a?(Array) ? row['edges'] : [])
      length_edge = axis == 'u' ? 'v' : 'u'
      count = ->(edge_axis) { edges.count { |edge| edge == "#{edge_axis}_min" || edge == "#{edge_axis}_max" } }
      measure = ->(value) { value.to_s.sub(/\.0+\z/, '').sub(/(\.\d*?)0+\z/) { Regexp.last_match(1) }.tr('.', ',') }
      length = measure.call(row['finished_length'] || row['length'])
      width = measure.call(row['finished_width'] || row['width'])
      segments = Array(row['outsourced_band_segments']).map { |value| "(#{measure.call(value.is_a?(Hash) ? value['length'] : value)})" }
      (length.empty? ? [] : Array.new(count.call(length_edge)) { "(#{length})" }).concat(
        width.empty? ? [] : Array.new(count.call(axis)) { "(#{width})" }).concat(segments).join(' ')
    end

    def self.excel_banding_cell(row)
      measures = edge_banding_measures(row)
      measures.match?(/\A\(\d+(?:,\d+)?\)\z/) ? "=\"#{measures}\"" : measures
    end

    def self.csv(rows)
      rows = rows.select do |row|
        raise ArgumentError, 'Peça inválida na lista de exportação.' unless row.is_a?(Hash)
        family = row['construction_type'] || row.dig('settings','construction_type') || 'mdf'
        next false if %w[glass metal].include?(family)
        raise ArgumentError, 'Família de peça não reconhecida para corte MDF.' unless family == 'mdf'
        true
      end
      "\uFEFF" + CSV.generate(col_sep: ';', row_sep: "\r\n") do |csv|
        csv << ['ID','Módulo','Peça','Quantidade','Comprimento (mm)','Largura (mm)','Espessura (mm)','Material','Veio','Acabado C (mm)','Acabado L (mm)','Bordas fitadas (mm)','Espessura da fita (mm)','Descontar fita']
        rows.each do |r|
          csv << [r['id'],csv_cell(r['module']),csv_cell(r['name']),1,
            csv_measure(r['length']),csv_measure(r['width']),csv_measure(r['thickness']),
            csv_cell(r['material']),{'free'=>'Livre','length'=>'No comprimento','width'=>'Na largura'}[r['grain']], csv_measure(r.fetch('finished_length',r['length'])),csv_measure(r.fetch('finished_width',r['width'])),
            excel_banding_cell(r), Array(r.fetch('outsourced_edges',r['edges'])).empty? && Array(r['outsourced_band_segments']).empty? ? 0 : csv_measure(r['tape_thickness']),
            r['edge_decrement'] && (!Array(r.fetch('outsourced_edges',r['edges'])).empty? || !Array(r['outsourced_band_segments']).empty?) ? 'Sim' : 'Não']
        end
      end
    end

    def self.escape(value); CGI.escapeHTML(value.to_s); end
    def self.html_measure(value); csv_measure(value); end
    def self.html(plan)
      settings = plan['settings']
      destinations = {}
      sheets = (plan['groups'] + Array(plan['virtual_groups'])).flat_map do |g|
        g['sheets'].each_with_index.map do |s,i|
          virtual = s['virtual']
          length = virtual ? s['canvas']['width'] : s['length']
          width = virtual ? s['canvas']['height'] : s['width']
          destination = virtual ? "Retalhos · #{html_measure(g['thickness'])} mm" : "#{g['material']} · #{s['offcut'] ? 'Retalho físico '+s['stock_id'] : 'Chapa '+(i+1).to_s}"
          s['placements'].each { |p| destinations[p['id']] = [destination, virtual ? '' : g['material']] }
          pieces = s['placements'].map do |p|
            "<rect x='#{p['x']}' y='#{p['y']}' width='#{p['w']}' height='#{p['h']}' fill='#dbe8dc' stroke='#426a50' stroke-width='2'/><text x='#{p['x']+p['w']/2}' y='#{p['y']+p['h']/2}' text-anchor='middle' font-size='24'>#{escape(p['id'])}</text>"
          end.join
          leftovers = s['free'].map { |r| "<rect x='#{r['x']}' y='#{r['y']}' width='#{r['w']}' height='#{r['h']}' fill='#fff8dc'/><title>Sobra #{html_measure(r['w'].round(1))} × #{html_measure(r['h'].round(1))} mm</title>" }.join
          remaining = s['free'].sort_by { |r| -r['w'] * r['h'] }.first(5).map { |r| "#{html_measure(r['w'].round(1))} × #{html_measure(r['h'].round(1))} mm" }.join(' / ')
          sequence = s['cuts'].map { |c| "<li>#{c['axis'] == 'x' ? 'Vertical · X' : 'Horizontal · Y'} = #{html_measure(c['at'].round(1))} mm, de #{html_measure(c['from'].round(1))} até #{html_measure(c['to'].round(1))} mm</li>" }.join
          details = virtual ? '<p>Chapa virtual · peças a produzir em retalhos disponíveis.</p>' : "<p>#{html_measure(length)} × #{html_measure(width)} mm · Aproveitamento: #{html_measure(s['utilization'])}%</p>"
          cuts = virtual ? '' : "<p>Maiores sobras previstas: #{remaining}</p><details><summary>Sequência de #{s['cuts'].length} cortes</summary><p>Após o refilo; origem no canto superior esquerdo do desenho. Serra avança à direita/abaixo da borda indicada.</p><ol>#{sequence}</ol></details>"
          "<section><h2>#{escape(g['material'])} · #{html_measure(g['thickness'])} mm · #{virtual ? 'Chapa virtual' : s['offcut'] ? 'Retalho físico '+escape(s['stock_id']) : 'Chapa '+(i+1).to_s}</h2>#{details}<svg viewBox='0 0 #{length} #{width}'><rect width='100%' height='100%' fill='#f6f1e7'/>#{leftovers}#{pieces}</svg>#{cuts}</section>"
        end
      end.join
      rows = plan['rows'].map do |r|
        values = %w[id module name length width thickness material grain finished_length finished_width].map { |key| %w[length width thickness finished_length finished_width].include?(key) ? html_measure(r[key]) : r[key] }
        values << edge_banding_measures(r)
        values.concat(destinations.fetch(r['id'], ['Não distribuída','']))
        "<tr>#{values.map { |value| "<td>#{escape(value)}</td>" }.join}</tr>"
      end.join
      missing = plan['unplaced'].map { |r| escape(r['id']) }.join(', ')
      "<!doctype html><html lang='pt-BR'><meta charset='utf-8'><title>#{plan['partial'] ? PARTIAL_WARNING : 'Plany — Plano de corte'}</title><style>body{font:14px Arial;color:#293b30;margin:30px}svg{width:100%;max-height:550px;border:1px solid #aaa}section{break-inside:avoid;margin:25px 0}table{border-collapse:collapse;width:100%;font-size:11px}td,th{border:1px solid #ccc;padding:6px;text-align:left}tr{break-inside:avoid}@media print{button{display:none}.partial-warning{position:fixed;top:0;left:0;right:0;background:white;padding:3mm;border-bottom:1px solid #a32620;font-size:12px}body.partial{padding-top:18mm}}</style><body class='#{plan['partial'] ? 'partial' : ''}'><h1>Plany — Plano de corte</h1>#{plan['partial'] ? "<p class='partial-warning'><strong>#{PARTIAL_WARNING}</strong> · #{count_text(plan['partial']['included_piece_count'],'peça incluída','peças incluídas')}; #{count_text(plan['partial']['excluded_count'],'pendência fora do corte.','pendências fora do corte.')}</p><details><summary>Pendências fora deste plano</summary><ul>#{plan['partial']['excluded_occurrences'].map { |item| '<li>'+CGI.escapeHTML([item['code'],item['module'],item['name'],item['occurrence_id'],item['detail']].join(' · '))+'</li>' }.join}</ul></details><script type='application/json' id='production-manifest'>#{JSON.generate(plan['partial']).gsub('<','\\u003c')}</script>" : ''}<p>#{count_text(plan['full_sheet_count'],'chapa inteira','chapas inteiras')} · #{count_text(plan['offcut_count'],'retalho físico','retalhos físicos')} · #{count_text(plan['piece_count'],'peça distribuída','peças distribuídas')} · #{count_text(plan.fetch('virtual_piece_count',0),'peça em Retalhos','peças em Retalhos')}</p><p>Formato de cada chapa física indicado abaixo · Serra #{html_measure(settings['kerf'])} mm · Refilo #{html_measure(settings['margin'])} mm por borda. Veio da chapa no comprimento.</p><p>Busca guilhotinada: #{plan['attempts_per_group']} tentativas por material/espessura. C e L são medidas de corte com os descontos de fita habilitados nas fichas. Acabado C/L são as medidas do modelo, antes desses descontos. Usinagens não incluídas.</p>#{missing.empty? ? '' : "<p><b>Não couberam: #{missing}. O plano está incompleto.</b></p>"}<button onclick='window.print()'>Imprimir / salvar PDF</button>#{sheets}<table><thead><tr>#{['ID','Módulo','Peça','C corte','L corte','Espessura','Material','Veio','C acabado','L acabado','Bordas fitadas (mm)','Destino','MDF utilizado'].map { |h| "<th>#{h}</th>" }.join}</tr></thead><tbody>#{rows}</tbody></table></html>"
    end
  end
end
