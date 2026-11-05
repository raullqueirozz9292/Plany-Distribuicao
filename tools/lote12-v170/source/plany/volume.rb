# encoding: UTF-8
module RQMyDina
  # Reference frames are snapshots. Loose components never keep source entity IDs.
  module Volume
    def self.selection(model)
      prefix = model.active_path || []
      raw = model.selection.to_a
      return [] if raw.empty? || raw.any? { |e| !Geometry.part?(e) || Graph.registered?(e) }
      raw.map { |entity| prefix + [entity] }
    end

    def self.frame(path)
      Graph.unit(Graph.transform(path))
    end

    def self.points(path, transform = Graph.transform(path), result = [])
      entity = path.last
      if Geometry.module?(entity) && Geometry.read(entity)['module_family'] == 'cabinet'
        p = Geometry.read(entity)
        [0, p['width']].product([0, p['depth']], [0, p['height']]).each { |v| result << Geom::Point3d.new(v.map(&:mm)).transform(transform) }
        return result
      end
      entity.definition.entities.each do |child|
        if Geometry.part?(child)
          next if child.get_attribute(Geometry::DICTIONARY, 'volume_linked', false)
          points(path + [child], transform * Graph.local_transform(child), result)
        elsif child.respond_to?(:vertices)
          child.vertices.each { |vertex| result << vertex.position.transform(transform) }
        elsif child.respond_to?(:start) && child.respond_to?(:end)
          result << child.start.position.transform(transform) << child.end.position.transform(transform)
        end
      end
      result
    end

    def self.reference(paths)
      raise ArgumentError, 'Selecione um módulo ou grupo.' if paths.empty?
      axes = frame(paths.first)
      box = Geom::BoundingBox.new
      paths.each { |path| points(path).each { |point| box.add(point.transform(axes.inverse)) } }
      raise ArgumentError, 'A seleção não tem um volume válido.' if box.empty?
      size = Geometry.measurements_mm([box.width, box.height, box.depth])
      raise ArgumentError, 'A seleção precisa ter largura, profundidade e altura.' if size.any? { |v| v < 0.1 }
      {'width'=>size[0], 'depth'=>size[1], 'height'=>size[2], 'transform'=>axes * Geom::Transformation.translation(box.min.to_a)}
    end

    def self.payload(model, paths)
      reference = self.reference(paths)
      pieces = paths.flat_map do |path|
        boards = []
        Graph.walk(path.last.definition.entities) do |relative|
          part = relative.last
          boards << relative if Graph.registered?(part)
          !Graph.registered?(part) && !part.get_attribute(Geometry::DICTIONARY, 'hardware')
        end
        boards.map do |relative|
          full = path + relative
          {'path'=>Graph.key(full), 'name'=>full.last.name, 'module'=>path.last.name}
        end
      end.uniq { |piece| piece['path'] }
      params = Library.user_defaults.merge(reference.reject { |key,_| key == 'transform' })
      params = params.merge('module_family'=>'functional', 'component_kind'=>'cladding', 'volume_bound'=>true,
        'fronts'=>[], 'trims'=>[], 'claddings'=>[], 'layout'=>{'id'=>'root'}, 'opening_layouts'=>[], 'piece_settings'=>{}, 'excluded_pieces'=>[], 'back'=>false)
      params['reference_trims'] = trim_reference(paths, reference)
      {'targets'=>paths.map { |path| Graph.key(path) }, 'names'=>paths.map { |path| path.last.name.to_s.strip.empty? ? Parameters::DEFAULTS['name'] : path.last.name },
        'width'=>reference['width'], 'height'=>reference['height'], 'depth'=>reference['depth'], 'pieces'=>pieces, 'params'=>params}
    end

    def self.trim_reference(paths, reference)
      low, high = 0.0, reference['height']
      visit = lambda do |path|
        e = path.last
        if Geometry.module?(e)
          p = Geometry.read(e)
          unless p.fetch('trims', []).empty?
            tr = reference['transform'].inverse * Graph.transform(path)
            Parameters.panels(p).select { |piece| piece['role'].start_with?('trim:') }.each do |piece|
              kind = piece['role'].split(':')[1]
              next if p['trims'].find { |t| t['kind'] == kind }.fetch('cover_cladding', true) == false
              origin, size = piece.values_at('origin','size')
              [origin[0],origin[0]+size[0]].product([origin[1],origin[1]+size[1]], [origin[2],origin[2]+size[2]]).each do |point|
                z = Geom::Point3d.new(point.map(&:mm)).transform(tr).z.to_mm
                low = [low,z].min if kind == 'baseboard'
                high = [high,z].max if kind == 'crown'
              end
            end
          end
        end
        e.definition.entities.each { |child| visit.call(path + [child]) if Geometry.part?(child) && !Graph.registered?(child) && !child.get_attribute(Geometry::DICTIONARY,'hardware') }
      end
      paths.each { |path| visit.call(path) }
      {'baseboard'=>-low, 'crown'=>high-reference['height']}.select { |_,height| height > 0.001 }
    end

    def self.recipe(kind, raw, bound = false)
      p = Marshal.load(Marshal.dump(raw))
      p.delete('assembly')
      p['layout'] = {'id'=>'root'}; p['opening_layouts'] = []
      p['excluded_pieces'] = []
      p['accessories'] = []
      p['back'] = false
      p['module_family'] = kind == 'baseboard' && !bound ? 'baseboard' : 'functional'
      p['volume_bound'] = bound
      p['component_kind'] = kind
      p['name'] = {'door'=>'Portas avulsas','drawer'=>'Gaveta avulsa', 'baseboard'=>'Rodapé avulso', 'crown'=>'Rodateto avulso', 'cladding'=>'Tamponamento avulso'}.fetch(kind)
      p['name'] = p['name'].sub(/ avuls[oa]s?\z/, '') if bound
      p['fronts'] = %w[door drawer].include?(kind) ? p.fetch('fronts', []).last(1).map { |f| f.merge('nodes'=>['root']) } : []
      p['claddings'] = [] unless kind == 'cladding'
      if kind == 'cladding'
        p['reference_trims'] ||= {}
        p.fetch('trims', []).each do |trim|
          next if trim['cover_cladding'] == false
          height = trim['kind'] == 'baseboard' && trim['structure_version'] == 1 ? trim['height']-trim['foot_height'] : trim['height']
          p['reference_trims'][trim['kind']] = [p['reference_trims'].fetch(trim['kind'], 0), height].max
        end
        p['trims'] = []
      else
        p['reference_trims'] = {}
      end
      if %w[baseboard crown].include?(kind)
        p['trims'] = p.fetch('trims', []).select { |t| t['kind'] == kind }
        raise ArgumentError, 'Configure o acabamento antes de criar.' if p['trims'].empty?
        p['height'] = p['trims'][0]['height'] unless bound
        p['thickness'] = p['trims'][0]['thickness']
      elsif %w[door drawer].include?(kind)
        p['trims'] = []
      end
      p['piece_settings'] = p.fetch('piece_settings', {}).select do |role,_|
         %w[door drawer].include?(kind) ? role.start_with?('front:') : kind == 'cladding' ? role.start_with?('cladding:') : role.start_with?("trim:#{kind}")
      end
      Parameters.normalize(p)
    end

    def self.create(model, kind, raw, ids, linked = false, door_area = nil)
      paths = Array(ids).map { |id| Graph.resolve(model, id) }
      raise ArgumentError, 'A seleção mudou ou está bloqueada.' if paths.any? { |path| path.empty? || path.any? { |e| !e.valid? || e.locked? } }
      raise ArgumentError, 'A seleção múltipla só permite componentes avulsos.' if linked && paths.length != 1
      reference = kind == 'door' ? door_area : self.reference(paths)
      raise ArgumentError, 'Selecione os vãos antes de criar a porta.' unless reference
      raw = raw.merge(reference.select { |key,_| %w[width height depth].include?(key) }) if kind == 'door'
      params = recipe(kind, raw, linked)
      transform = reference.fetch('transform')
      transform *= Geom::Transformation.translation([0,0,-params['height'].mm]) if kind == 'baseboard' && !linked
      transform *= Geom::Transformation.translation([0,0,reference['height'].mm]) if kind == 'crown' && !linked
      instance = parent = nil
      Geometry.transaction(model, 'Plany: inserir componente por volume') do
        definition = Geometry.build_definition(model, params)
        if linked
          parent = Graph.unique(paths.first)
          local_transform = Graph.transform(parent).inverse * transform
          instance = parent.last.definition.entities.add_instance(definition, local_transform)
          Graph.set_local_transform(instance, local_transform)
          instance.set_attribute(Geometry::DICTIONARY, 'volume_linked', true)
          instance.set_attribute(Geometry::DICTIONARY, 'volume_reference', JSON.generate(reference.select { |key,_| %w[width height depth].include?(key) }))
        else
          instance = model.entities.add_instance(definition, transform)
        end
        Geometry.store(instance, params)
        model.active_path = linked && parent.length > 1 ? parent[0...-1] : nil
        model.selection.clear
        # Selection into a nested definition is handled by the Plany focus path.
        model.selection.add(linked ? parent.last : instance)
      end
      linked ? parent + [instance] : [instance]
    end

    def self.refresh_linked(model, instance, old, params)
      linked = instance.definition.entities.to_a.select { |e| Geometry.module?(e) && e.get_attribute(Geometry::DICTIONARY, 'volume_linked', false) }
      return if linked.empty? || %w[width height depth].all? { |key| old[key] == params[key] }
      source_path = nil
      Graph.walk(model.entities) do |path|
        source_path ||= path if path.last == instance
        !Graph.registered?(path.last) && !path.last.get_attribute(Geometry::DICTIONARY, 'hardware')
      end
      raise ArgumentError, 'A referência do componente vinculado mudou.' unless source_path
      current = self.reference([source_path])
      previous_batch = Geometry.instance_variable_get(:@inside_batch)
      Geometry.instance_variable_set(:@inside_batch, true)
      begin
        linked.each do |child|
          raise ArgumentError, 'Desbloqueie os componentes vinculados antes de redimensionar.' if child.locked?
          recipe = Geometry.read(child)
          next if recipe['component_kind'] == 'door'
          previous = JSON.parse(child.get_attribute(Geometry::DICTIONARY, 'volume_reference', '{}'))
          %w[width height depth].each do |key|
            next unless previous[key]
            recipe[key] += current[key] - previous[key]
            previous[key] = current[key]
          end
          Geometry.update(model, child, recipe)
          Graph.set_local_transform(child, Graph.transform(source_path).inverse * current.fetch('transform'))
          child.set_attribute(Geometry::DICTIONARY, 'volume_reference', JSON.generate(previous))
        end
      ensure
        Geometry.instance_variable_set(:@inside_batch, previous_batch)
      end
    end

    # Rectangular boundaries in a group's local axes, including ordinary SketchUp geometry.
    def self.group_windows(path)
      surfaces = []
      visit = lambda do |entity, tr|
        if Geometry.part?(entity)
          return if Geometry.module?(entity) || entity.get_attribute(Geometry::DICTIONARY, 'volume_linked', false)
          entity.definition.entities.each { |child| visit.call(child, tr * (Geometry.part?(child) ? Graph.local_transform(child) : Geom::Transformation.new)) }
        elsif entity.is_a?(Sketchup::Face)
          vertices = entity.vertices.map { |v| v.position.transform(tr).to_a.map(&:to_mm) }
          return unless vertices.length == 4 && entity.loops.length == 1
          mins = 3.times.map { |axis| vertices.map { |v| v[axis] }.min }
          maxs = 3.times.map { |axis| vertices.map { |v| v[axis] }.max }
          axis = [0,2].find { |i| maxs[i] - mins[i] < 0.01 }
          return unless axis && maxs[1] - mins[1] >= 10 && maxs[2-axis] - mins[2-axis] >= 50
          return unless vertices.all? { |v| 3.times.all? { |i| (v[i]-mins[i]).abs < 0.01 || (v[i]-maxs[i]).abs < 0.01 } }
          surfaces << {'axis'=>axis, 'position'=>mins[axis], 'lo'=>mins, 'hi'=>maxs}
        end
      end
      path.last.definition.entities.each { |e| visit.call(e, Geometry.part?(e) ? Graph.local_transform(e) : Geom::Transformation.new) }
      vertical = surfaces.select { |s| s['axis'] == 0 }
      horizontal = surfaces.select { |s| s['axis'] == 2 }
      xs = vertical.map { |s| s['position'].round(4) }.uniq.sort
      result = []
      xs.each_cons(2) do |left,right|
        next if right - left < 50
        rows = horizontal.select { |s| s['lo'][0] <= left + 0.01 && s['hi'][0] >= right - 0.01 }
        rows.map { |s| s['position'].round(4) }.uniq.sort.each_cons(2) do |bottom,top|
          next if top - bottom < 50
          boundaries = [[vertical,left], [vertical,right], [rows,bottom], [rows,top]].map do |pool,position|
            pool.select { |s| (s['position']-position).abs < 0.01 && (s['axis'] == 2 || s['lo'][2] <= bottom + 0.01 && s['hi'][2] >= top - 0.01) }
          end
          next if boundaries.any?(&:empty?)
          front = boundaries.map { |pool| pool.map { |s| s['lo'][1] }.min }.max
          rear = boundaries.map { |pool| pool.map { |s| s['hi'][1] }.max }.min
          next if rear - front < 10
          result << {'id'=>"group_#{result.length}", 'x'=>left, 'z'=>bottom, 'width'=>right-left, 'height'=>top-bottom, 'front'=>front, 'rear'=>rear, 'depth'=>rear-front}
        end
      end
      result
    end

    def self.project_openings(model)
      result = []
      Graph.walk(model.entities) do |path|
        entity = path.last
        next false if path.any? { |e| e.hidden? || e.locked? || !e.layer.visible? }
        if Geometry.module?(entity)
          p = Geometry.read(entity)
          windows = p['module_family'] == 'cabinet' ? Parameters.windows(p) : p['module_family'] == 'custom' ? group_windows(path) : []
          windows.each_with_index { |window,i| result << {path:path, window:window, number:i+1, transform:Graph.transform(path)} }
          # Nested independent modules keep their own openings.
          true
        elsif !Graph.registered?(entity)
          next false if entity.get_attribute(Geometry::DICTIONARY, 'category') || entity.get_attribute(Geometry::DICTIONARY, 'motion_key') || entity.get_attribute(Geometry::DICTIONARY, 'hardware')
          group_windows(path).each_with_index { |window,i| result << {path:path, window:window, number:i+1, transform:Graph.transform(path)} }
          true
        else
          false
        end
      end
      result
    end
  end

  class LooseDoorSelectionTool < OpeningSelectionTool
    attr_writer :scope
    def activate
      super
      if @entries.empty?
        Sketchup.set_status_text('Nenhum vão retangular disponível nesta seleção ou no projeto.')
      end
    end
    def refresh
      # Geometry is immutable during this tool session; selection changes do not rescan it.
      @entries ||= []
      @entries = Volume.project_openings(@model) unless @catalog_loaded
      if @scope && !@scope.empty?
        @entries.select! { |entry| @scope.any? { |key| Graph.key(entry[:path]) == key || Graph.key(entry[:path]).start_with?(key + '/') } }
      end
      @catalog_loaded = true
      @refreshed_at = Time.now.to_f
    end

    def parallel?(entry)
      return true unless @reference_frame
      a = Graph.axes(@reference_frame)[1].normalize
      b = Graph.axes(entry[:transform])[1].normalize
      a.dot(b).abs >= 1.0 - 1e-6
    end

    def pick(x, y, view)
      all = @entries
      @entries = all.select { |entry| parallel?(entry) }
      super
    ensure
      @entries = all
    end

    def rectangle(entry)
      window = entry[:window]
      transform = @reference_frame.inverse * entry[:transform]
      points = [window['x'], window['x']+window['width']].product([window['z'], window['z']+window['height']]).map do |x,z|
        Geom::Point3d.new(x.mm, window['front'].mm, z.mm).transform(transform).to_a.map(&:to_mm)
      end
      {'x0'=>points.map { |p| p[0] }.min, 'x1'=>points.map { |p| p[0] }.max,
        'z0'=>points.map { |p| p[2] }.min, 'z1'=>points.map { |p| p[2] }.max, 'front'=>points.map { |p| p[1] }.min}
    end

    def onLButtonDown(_flags, x, y, view)
      return unless Sketchup.active_model == @model
      hit = pick(x,y,view)
      return unless hit
      entry = hit[1]
      @anchor ||= entry
      @reference_frame ||= Volume.frame(@anchor[:path])
      selected = [@anchor,entry].uniq
      compatible = @entries.select { |candidate| parallel?(candidate) }
      bounds = nil
      loop do
        rectangles = selected.map { |candidate| rectangle(candidate) }
        bounds = {'x0'=>rectangles.map { |r| r['x0'] }.min, 'x1'=>rectangles.map { |r| r['x1'] }.max,
          'z0'=>rectangles.map { |r| r['z0'] }.min, 'z1'=>rectangles.map { |r| r['z1'] }.max}
        expanded = compatible.select do |candidate|
          r = rectangle(candidate)
          [r['x1'],bounds['x1']].min - [r['x0'],bounds['x0']].max > 1e-6 && [r['z1'],bounds['z1']].min - [r['z0'],bounds['z0']].max > 1e-6
        end
        break if expanded.map { |candidate| entry_key(candidate) }.sort == selected.map { |candidate| entry_key(candidate) }.sort
        selected = expanded
      end
      front = selected.map { |candidate| rectangle(candidate)['front'] }.min
      @area = {'width'=>bounds['x1']-bounds['x0'], 'height'=>bounds['z1']-bounds['z0'],
        'depth'=>selected.map { |candidate| candidate[:window]['depth'] }.min,
        'transform'=>@reference_frame * Geom::Transformation.translation([bounds['x0'].mm, front.mm, bounds['z0'].mm])}
      @runtime.instance_variable_set(:@loose_door_area, @area.merge('model'=>@model, 'paths'=>selected.map { |e| e[:path] }))
      @runtime.send_to_panel('loose_door_area'=>@area.reject { |key,_| key == 'transform' }, 'opening_tool'=>'door',
        'message'=>"Área da porta: #{selected.length} vão(s). Conclua no Plany.")
      view.invalidate
    rescue StandardError => error
      @runtime.send_to_panel('error'=>error.message)
    end

    def draw_door_selection(view)
      return unless @area
      tr = @area['transform']; w = @area['width'].mm; h = @area['height'].mm
      points = [[0,0,0],[w,0,0],[w,0,h],[0,0,h]].map { |p| Geom::Point3d.new(p).transform(tr) }
      view.drawing_color = Sketchup::Color.new(44,144,111,65)
      view.draw(GL_QUADS, points)
      view.drawing_color = Sketchup::Color.new(44,144,111)
      view.line_width = 3; view.draw(GL_LINE_LOOP, points)
    end

    def draw(view)
      all = @entries
      @entries = all.select { |entry| parallel?(entry) }
      super
    ensure
      @entries = all
    end
  end
end
